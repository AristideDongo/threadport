import { randomUUID } from 'node:crypto';
import { assertTitle, type AgentRun, type ContextMode, type RecordKind, type RecordStatus, type Session, type Snapshot, type WorkRecord } from '../domain/model.js';
import { buildContextPack, excluded, gitFingerprint, redact } from './context.js';
import type { AgentAdapter, AgentRunner, CommandExecutor, GitReader, SessionStore } from './ports.js';

export class ThreadPort {
  constructor(private readonly store: SessionStore, private readonly git: GitReader, private readonly cwd: string, private readonly patterns: readonly string[] = []) {}

  recover(): number { return this.store.recoverRuns(new Date().toISOString()); }
  sessions(): Session[] { return this.store.listSessions(); }
  active(): Session | null { return this.store.getActiveSession(); }
  session(id: string): Session {
    const session = this.store.getSession(id);
    if (!session) throw new Error(`Session not found: ${id}`);
    return session;
  }
  newSession(title: string): Session {
    const now = new Date().toISOString();
    const session: Session = { id: randomUUID().slice(0, 8), title: redact(assertTitle(title)), status: 'active', createdAt: now, updatedAt: now };
    this.store.transaction(() => {
      const previous = this.active();
      if (previous) this.store.updateSession({ ...previous, status: 'paused', updatedAt: now });
      this.store.createSession(session);
      this.event(session.id, 'SessionCreated', session.title);
    });
    return session;
  }
  rename(id: string, title: string): Session {
    const updated = { ...this.session(id), title: redact(assertTitle(title)), updatedAt: new Date().toISOString() };
    this.store.updateSession(updated);
    this.event(id, 'SessionRenamed', id);
    return updated;
  }
  finish(id: string): Session {
    const session = this.session(id);
    if (this.store.listRuns(id).some((run) => run.status === 'running')) throw new Error('Stop active agent runs before finishing this session.');
    const updated: Session = { ...session, status: 'done', updatedAt: new Date().toISOString() };
    this.store.updateSession(updated);
    this.event(id, 'SessionFinished', id);
    return updated;
  }
  deleteSession(id: string): void {
    this.session(id);
    if (this.store.listRuns(id).some((run) => run.status === 'running')) throw new Error('Stop active agent runs before deleting this session.');
    if (this.store.listForks(id).length) throw new Error('Remove session forks before deleting this session.');
    this.store.deleteSession(id);
  }
  open(id: string): Session {
    return this.store.transaction(() => {
      const session = this.session(id);
      const current = this.active();
      if (current && current.id !== id) this.store.updateSession({ ...current, status: 'paused', updatedAt: new Date().toISOString() });
      const opened: Session = { ...session, status: 'active', updatedAt: new Date().toISOString() };
      this.store.updateSession(opened);
      this.event(id, 'SessionOpened', 'Session active');
      return opened;
    });
  }
  events(id: string) { return this.store.listEvents(id); }
  decisions(id: string) { return this.store.listDecisions(id); }
  runs(id: string) { return this.store.listRuns(id); }
  records(id: string): WorkRecord[] { return this.store.listRecords(id); }
  search(query: string) { return this.store.search(query, 30); }
  forks(id: string) { return this.store.listForks(id); }
  addRecord(kind: RecordKind, title: string, body = '', status: RecordStatus = 'info', runId: string | null = null): WorkRecord {
    const session = this.requireActive();
    if ((kind === 'file' || kind === 'artifact') && excluded(title, this.patterns)) throw new Error('This path is excluded by the project privacy policy.');
    const record: WorkRecord = { id: randomUUID().slice(0, 8), sessionId: session.id, runId, kind, title: redact(assertTitle(title)), body: redact(body.trim().slice(0, 20000)), status, createdAt: new Date().toISOString(), forkId: this.forkId(session.id) };
    this.store.addRecord(record);
    this.event(session.id, `${kind[0]?.toUpperCase() ?? ''}${kind.slice(1)}Recorded`, record.id);
    return record;
  }
  updateRecord(id: string, title: string, body?: string): WorkRecord {
    const item = this.store.getRecord(id);
    if (!item || item.sessionId !== this.requireActive().id) throw new Error(`Record not found: ${id}`);
    if ((item.kind === 'file' || item.kind === 'artifact') && excluded(title, this.patterns)) throw new Error('This path is excluded by the project privacy policy.');
    const updated = { ...item, title: redact(assertTitle(title)), body: body === undefined ? item.body : redact(body.trim().slice(0, 20_000)) };
    this.store.updateRecord(updated);
    this.event(item.sessionId, 'RecordUpdated', id);
    return updated;
  }
  deleteRecord(id: string): void {
    const item = this.store.getRecord(id);
    if (!item || item.sessionId !== this.requireActive().id) throw new Error(`Record not found: ${id}`);
    this.store.deleteRecord(id);
    this.event(item.sessionId, 'RecordDeleted', id);
  }
  scrub(): { updated: number; removed: number } { return this.store.scrub(this.patterns); }
  addRunRecord(kind: RecordKind, title: string, body = '', status: RecordStatus = 'info'): WorkRecord {
    const session = this.requireActive();
    const running = this.store.listRuns(session.id).findLast((item) => item.status === 'running' && (item.forkId ?? null) === this.forkId(session.id));
    return this.addRecord(kind, title, body, status, running?.id ?? null);
  }
  linkProviderSession(providerSessionId: string): void {
    const session = this.requireActive();
    const running = this.store.listRuns(session.id).findLast((item) => item.status === 'running' && (item.forkId ?? null) === this.forkId(session.id));
    if (running && providerSessionId) this.store.setProviderSessionId(running.id, providerSessionId);
  }
  completeTask(id: string): WorkRecord {
    const task = this.store.getRecord(id);
    if (!task || task.kind !== 'task' || task.sessionId !== this.requireActive().id) throw new Error(`Task not found: ${id}`);
    const done: WorkRecord = { ...task, status: 'done' };
    this.store.updateRecord(done);
    this.event(task.sessionId, 'TaskCompleted', task.id);
    return done;
  }
  summarize(): WorkRecord {
    const session = this.requireActive();
    const records = this.records(session.id).filter((item) => (item.forkId ?? null) === this.forkId(session.id));
    const completed = records.filter((item) => item.kind === 'task' && item.status === 'done');
    const pending = records.filter((item) => item.kind === 'task' && item.status === 'open');
    const errors = records.filter((item) => item.kind === 'error' && item.status !== 'done');
    const tests = records.filter((item) => item.kind === 'test').slice(-3);
    const notes = records.filter((item) => item.kind === 'note').slice(-3);
    const decisions = this.decisions(session.id).slice(-5);
    const lastRun = this.runs(session.id).at(-1);
    const git = this.git.read(this.cwd);
    const lines = [
      `Completed: ${completed.map((item) => item.title).join('; ') || 'none recorded'}`,
      `Pending: ${pending.map((item) => item.title).join('; ') || 'none recorded'}`,
      `Open errors: ${errors.map((item) => item.title).join('; ') || 'none recorded'}`,
      `Recent tests: ${tests.map((item) => `${item.title} (${item.status})`).join('; ') || 'none recorded'}`,
      `Recent notes: ${notes.map((item) => `${item.title}${item.body ? ` — ${item.body.slice(0, 500)}` : ''}`).join('; ') || 'none recorded'}`,
      `Decisions: ${decisions.map((item) => item.title).join('; ') || 'none recorded'}`,
      `Last agent: ${lastRun ? `${lastRun.agentId} (${lastRun.status})` : 'none'}`,
      `Git: ${git?.branch ?? 'unknown branch'}, ${git?.changedFiles.length ?? 0} changed files`,
      `Git fingerprint: ${gitFingerprint(git, this.patterns) ?? 'unavailable'}`,
    ];
    return this.addRecord('summary', `Summary for ${session.title}`, lines.join('\n'));
  }
  async check(command: string, args: string[], executor: CommandExecutor): Promise<number> {
    const line = [command, ...args].join(' ');
    this.addRecord('command', line);
    const result = await executor.execute(command, args, this.cwd);
    this.addRecord('test', line, result.output, result.code === 0 ? 'done' : 'failed');
    return result.code;
  }
  decide(title: string, rationale: string): void {
    const session = this.requireActive();
    const decision = { id: randomUUID(), sessionId: session.id, title: redact(assertTitle(title)), rationale: redact(rationale), createdAt: new Date().toISOString() };
    this.store.addDecision(decision);
    this.event(session.id, 'DecisionCreated', decision.id);
  }
  snapshot(): Snapshot {
    const session = this.requireActive();
    const git = this.git.read(this.cwd);
    if (!git) throw new Error('This directory is not a Git repository.');
    const snapshot: Snapshot = { id: randomUUID(), sessionId: session.id, createdAt: new Date().toISOString(), git: { ...git, changedFiles: git.changedFiles.filter((path) => !excluded(path, this.patterns)).map(redact), diff: '' } };
    this.store.addSnapshot(snapshot);
    this.event(session.id, 'ContextSnapshotCreated', `${git.changedFiles.length} changed file(s)`);
    return snapshot;
  }
  context(mode: ContextMode, patterns: readonly string[]): string {
    const session = this.requireActive();
    return buildContextPack(this.store, session, this.git.read(this.cwd), mode, patterns, this.forkId(session.id)).text;
  }
  contextPack(mode: ContextMode, patterns: readonly string[]) {
    const session = this.requireActive();
    return buildContextPack(this.store, session, this.git.read(this.cwd), mode, patterns, this.forkId(session.id));
  }
  async run(adapter: AgentAdapter, runner: AgentRunner, contextFile: string, providerSessionId: string | null = null): Promise<AgentRun> {
    const session = this.requireActive();
    if (this.store.listRuns(session.id).some((item) => item.status === 'running' && (item.forkId ?? null) === this.forkId(session.id))) throw new Error('A run is already active in this environment.');
    if (!runner.available(adapter.command)) throw new Error(`${adapter.label} was not found (${adapter.command}). Run "threadport doctor".`);
    const previous = this.store.listRuns(session.id).at(-1);
    this.snapshotIfGit();
    if (previous && previous.agentId !== adapter.id) this.event(session.id, 'AgentSwitched', `${previous.agentId} → ${adapter.id}`);
    const run: AgentRun = { id: randomUUID().slice(0, 8), sessionId: session.id, agentId: adapter.id, status: 'running', startedAt: new Date().toISOString(), endedAt: null, exitCode: null, ownerPid: process.pid, forkId: this.forkId(session.id), providerSessionId };
    this.store.addRun(run);
    this.event(session.id, 'AgentRunStarted', adapter.label);
    let code: number;
    try { code = await runner.run(adapter.command, adapter.args(contextFile), this.cwd); }
    catch (error: unknown) { code = 1; this.event(session.id, 'ErrorDetected', error instanceof Error ? error.message : String(error)); }
    const finished: AgentRun = { ...run, status: code === 0 ? 'completed' : 'failed', endedAt: new Date().toISOString(), exitCode: code };
    this.store.updateRun(finished);
    this.snapshotIfGit();
    this.event(session.id, 'AgentRunStopped', `${adapter.label} (exit code ${code})`);
    this.summarize();
    return finished;
  }
  private snapshotIfGit(): void { if (this.git.read(this.cwd)) this.snapshot(); }
  private forkId(sessionId: string): string | null { return this.store.listForks(sessionId).find((fork) => fork.path === this.cwd)?.id ?? null; }
  private requireActive(): Session { const session = this.active(); if (!session) throw new Error('No active session. Run "threadport new <objective>".'); return session; }
  private event(sessionId: string, type: string, message: string): void {
    this.store.addEvent({ id: randomUUID(), sessionId, type, message: redact(message), createdAt: new Date().toISOString() });
  }
}
