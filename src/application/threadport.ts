import { randomUUID } from 'node:crypto';
import { assertTitle, type AgentRun, type ContextMode, type Session, type Snapshot } from '../domain/model.js';
import { buildContext } from './context.js';
import type { AgentAdapter, AgentRunner, GitReader, SessionStore } from './ports.js';

export class ThreadPort {
  constructor(private readonly store: SessionStore, private readonly git: GitReader, private readonly cwd: string) {}

  recover(): number { return this.store.recoverRuns(new Date().toISOString()); }
  sessions(): Session[] { return this.store.listSessions(); }
  active(): Session | null { return this.store.getActiveSession(); }
  session(id: string): Session {
    const session = this.store.getSession(id);
    if (!session) throw new Error(`Session introuvable : ${id}`);
    return session;
  }
  newSession(title: string): Session {
    const now = new Date().toISOString();
    const previous = this.active();
    if (previous) this.store.updateSession({ ...previous, status: 'paused', updatedAt: now });
    const session: Session = { id: randomUUID().slice(0, 8), title: assertTitle(title), status: 'active', createdAt: now, updatedAt: now };
    this.store.createSession(session);
    this.event(session.id, 'SessionCreated', session.title);
    return session;
  }
  open(id: string): Session {
    const session = this.session(id);
    const current = this.active();
    if (current && current.id !== id) this.store.updateSession({ ...current, status: 'paused', updatedAt: new Date().toISOString() });
    const opened: Session = { ...session, status: 'active', updatedAt: new Date().toISOString() };
    this.store.updateSession(opened);
    this.event(id, 'SessionOpened', 'Session active');
    return opened;
  }
  events(id: string) { return this.store.listEvents(id); }
  decisions(id: string) { return this.store.listDecisions(id); }
  runs(id: string) { return this.store.listRuns(id); }
  decide(title: string, rationale: string): void {
    const session = this.requireActive();
    this.store.addDecision({ id: randomUUID(), sessionId: session.id, title: assertTitle(title), rationale, createdAt: new Date().toISOString() });
    this.event(session.id, 'DecisionCreated', title);
  }
  snapshot(): Snapshot {
    const session = this.requireActive();
    const git = this.git.read(this.cwd);
    if (!git) throw new Error('Ce dossier n’est pas un dépôt Git.');
    const snapshot: Snapshot = { id: randomUUID(), sessionId: session.id, createdAt: new Date().toISOString(), git: { ...git, diff: '' } };
    this.store.addSnapshot(snapshot);
    this.event(session.id, 'ContextSnapshotCreated', `${git.changedFiles.length} fichier(s) modifié(s)`);
    return snapshot;
  }
  context(mode: ContextMode, patterns: readonly string[]): string {
    const session = this.requireActive();
    return buildContext(this.store, session, this.git.read(this.cwd), mode, patterns);
  }
  async run(adapter: AgentAdapter, runner: AgentRunner, contextFile: string): Promise<AgentRun> {
    const session = this.requireActive();
    if (!runner.available(adapter.command)) throw new Error(`${adapter.label} est introuvable (${adapter.command}). Lancez « threadport doctor ».`);
    const previous = this.store.listRuns(session.id).at(-1);
    this.snapshotIfGit();
    if (previous && previous.agentId !== adapter.id) this.event(session.id, 'AgentSwitched', `${previous.agentId} → ${adapter.id}`);
    const run: AgentRun = { id: randomUUID().slice(0, 8), sessionId: session.id, agentId: adapter.id, status: 'running', startedAt: new Date().toISOString(), endedAt: null, exitCode: null };
    this.store.addRun(run);
    this.event(session.id, 'AgentRunStarted', adapter.label);
    let code: number;
    try { code = await runner.run(adapter.command, adapter.args(contextFile), this.cwd); }
    catch (error: unknown) { code = 1; this.event(session.id, 'ErrorDetected', error instanceof Error ? error.message : String(error)); }
    const finished: AgentRun = { ...run, status: code === 0 ? 'completed' : 'failed', endedAt: new Date().toISOString(), exitCode: code };
    this.store.updateRun(finished);
    this.snapshotIfGit();
    this.event(session.id, 'AgentRunStopped', `${adapter.label} (code ${code})`);
    return finished;
  }
  private snapshotIfGit(): void { if (this.git.read(this.cwd)) this.snapshot(); }
  private requireActive(): Session { const session = this.active(); if (!session) throw new Error('Aucune session active. Lancez « threadport new <objectif> ».'); return session; }
  private event(sessionId: string, type: string, message: string): void {
    this.store.addEvent({ id: randomUUID(), sessionId, type, message, createdAt: new Date().toISOString() });
  }
}
