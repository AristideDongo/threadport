import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentRun, Decision, Fork, GitState, SearchHit, Session, Snapshot, TimelineEvent, WorkRecord } from '../domain/model.js';
import type { SessionStore } from '../application/ports.js';
import { excluded, redact } from '../application/context.js';

type Row = Record<string, unknown>;
function str(value: unknown): string { if (typeof value !== 'string') throw new Error('Invalid SQLite data.'); return value; }
function nullableStr(value: unknown): string | null { return value === null ? null : str(value); }
function nullableNum(value: unknown): number | null { if (value === null) return null; if (typeof value !== 'number') throw new Error('Invalid SQLite data.'); return value; }
function session(row: Row): Session { return { id: str(row.id), title: str(row.title), status: str(row.status) as Session['status'], createdAt: str(row.created_at), updatedAt: str(row.updated_at) }; }
function run(row: Row): AgentRun { return { id: str(row.id), sessionId: str(row.session_id), agentId: str(row.agent_id), status: str(row.status) as AgentRun['status'], startedAt: str(row.started_at), endedAt: nullableStr(row.ended_at), exitCode: nullableNum(row.exit_code), ownerPid: row.owner_pid === undefined ? null : nullableNum(row.owner_pid), forkId: row.fork_id === undefined ? null : nullableStr(row.fork_id), providerSessionId: row.provider_session_id === undefined ? null : nullableStr(row.provider_session_id) }; }
function event(row: Row): TimelineEvent { return { id: str(row.id), sessionId: str(row.session_id), type: str(row.type), message: str(row.message), createdAt: str(row.created_at) }; }
function decision(row: Row): Decision { return { id: str(row.id), sessionId: str(row.session_id), title: str(row.title), rationale: str(row.rationale), createdAt: str(row.created_at) }; }
function record(row: Row): WorkRecord { return { id: str(row.id), sessionId: str(row.session_id), runId: nullableStr(row.run_id), kind: str(row.kind) as WorkRecord['kind'], title: str(row.title), body: str(row.body), status: str(row.status) as WorkRecord['status'], createdAt: str(row.created_at), forkId: row.fork_id === undefined ? null : nullableStr(row.fork_id) }; }
function fork(row: Row): Fork { return { id: str(row.id), sessionId: str(row.session_id), agentId: str(row.agent_id), branch: str(row.branch), path: str(row.path), baseHead: str(row.base_head), createdAt: str(row.created_at) }; }
function gitState(raw: string): GitState {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== 'object' || value === null || !('changedFiles' in value) || !Array.isArray(value.changedFiles)) throw new Error('Invalid Git snapshot.');
  return value as GitState;
}

export class SqliteStore implements SessionStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    this.db.exec('BEGIN IMMEDIATE');
    try {
    const version = this.db.prepare('PRAGMA user_version').get() as Row | undefined;
    if (version && Number(version.user_version) > 5) throw new Error('Database was created by a newer version of ThreadPort.');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), agent_id TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, exit_code INTEGER);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), type TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), title TEXT NOT NULL, rationale TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), created_at TEXT NOT NULL, git_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_session ON events(session_id, created_at);
      CREATE INDEX IF NOT EXISTS runs_session ON runs(session_id, started_at);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_session ON sessions(status) WHERE status='active';
    `);
    if (!version || Number(version.user_version) < 2) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS work_records (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), run_id TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS work_records_session ON work_records(session_id, created_at);
        CREATE TABLE IF NOT EXISTS forks (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), agent_id TEXT NOT NULL, branch TEXT NOT NULL, path TEXT NOT NULL, base_head TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(source UNINDEXED, id UNINDEXED, session_id UNINDEXED, title, body);
        INSERT INTO search_index (source,id,session_id,title,body) SELECT 'session',id,id,title,'' FROM sessions;
        INSERT INTO search_index (source,id,session_id,title,body) SELECT 'decision',id,session_id,title,rationale FROM decisions;
        PRAGMA user_version = 2;
      `);
    }
    if (!version || Number(version.user_version) < 3) this.db.exec('ALTER TABLE runs ADD COLUMN owner_pid INTEGER; PRAGMA user_version = 3;');
    if (!version || Number(version.user_version) < 4) this.db.exec('ALTER TABLE runs ADD COLUMN fork_id TEXT; ALTER TABLE work_records ADD COLUMN fork_id TEXT; PRAGMA user_version = 4;');
    if (!version || Number(version.user_version) < 5) this.db.exec('ALTER TABLE runs ADD COLUMN provider_session_id TEXT; PRAGMA user_version = 5;');
    this.db.exec('COMMIT');
    } catch (error: unknown) { this.db.exec('ROLLBACK'); this.db.close(); throw error; }
  }
  close(): void { this.db.close(); }
  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error: unknown) { this.db.exec('ROLLBACK'); throw error; }
  }
  createSession(value: Session): void { this.db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)').run(value.id, value.title, value.status, value.createdAt, value.updatedAt); this.index('session', value.id, value.id, value.title, ''); }
  updateSession(value: Session): void {
    this.db.prepare('UPDATE sessions SET title=?, status=?, updated_at=? WHERE id=?').run(value.title, value.status, value.updatedAt, value.id);
    this.db.prepare("UPDATE search_index SET title=? WHERE source='session' AND id=?").run(value.title, value.id);
  }
  deleteSession(id: string): void {
    this.transaction(() => {
      for (const table of ['events', 'decisions', 'runs', 'snapshots', 'work_records', 'forks']) this.db.prepare(`DELETE FROM ${table} WHERE session_id=?`).run(id);
      this.db.prepare('DELETE FROM search_index WHERE session_id=?').run(id);
      this.db.prepare('DELETE FROM sessions WHERE id=?').run(id);
    });
  }
  getSession(id: string): Session | null { const row = this.db.prepare('SELECT * FROM sessions WHERE id=?').get(id) as Row | undefined; return row ? session(row) : null; }
  listSessions(): Session[] { return (this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as Row[]).map(session); }
  getActiveSession(): Session | null { const row = this.db.prepare("SELECT * FROM sessions WHERE status='active' ORDER BY updated_at DESC LIMIT 1").get() as Row | undefined; return row ? session(row) : null; }
  addEvent(value: TimelineEvent): void { this.db.prepare('INSERT INTO events VALUES (?, ?, ?, ?, ?)').run(value.id, value.sessionId, value.type, value.message, value.createdAt); }
  listEvents(sessionId: string): TimelineEvent[] { return (this.db.prepare('SELECT * FROM events WHERE session_id=? ORDER BY created_at, rowid').all(sessionId) as Row[]).map(event); }
  addDecision(value: Decision): void { this.db.prepare('INSERT INTO decisions VALUES (?, ?, ?, ?, ?)').run(value.id, value.sessionId, value.title, value.rationale, value.createdAt); this.index('decision', value.id, value.sessionId, value.title, value.rationale); }
  listDecisions(sessionId: string): Decision[] { return (this.db.prepare('SELECT * FROM decisions WHERE session_id=? ORDER BY created_at').all(sessionId) as Row[]).map(decision); }
  addRun(value: AgentRun): void { this.db.prepare('INSERT INTO runs (id,session_id,agent_id,status,started_at,ended_at,exit_code,owner_pid,fork_id,provider_session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(value.id, value.sessionId, value.agentId, value.status, value.startedAt, value.endedAt, value.exitCode, value.ownerPid ?? null, value.forkId ?? null, value.providerSessionId ?? null); }
  updateRun(value: AgentRun): void { this.db.prepare('UPDATE runs SET status=?, ended_at=?, exit_code=? WHERE id=?').run(value.status, value.endedAt, value.exitCode, value.id); }
  setProviderSessionId(runId: string, providerSessionId: string): void { this.db.prepare('UPDATE runs SET provider_session_id=? WHERE id=?').run(providerSessionId, runId); }
  listRuns(sessionId: string): AgentRun[] { return (this.db.prepare('SELECT * FROM runs WHERE session_id=? ORDER BY started_at, rowid').all(sessionId) as Row[]).map(run); }
  recoverRuns(now: string): number {
    const pending = (this.db.prepare("SELECT id, session_id, agent_id, owner_pid FROM runs WHERE status='running'").all() as Row[]).filter((row) => {
      const pid = nullableNum(row.owner_pid);
      if (!pid) return true;
      try { process.kill(pid, 0); return false; } catch (error: unknown) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
    });
    this.db.exec('BEGIN');
    try {
      for (const row of pending) {
        const updated = this.db.prepare("UPDATE runs SET status='interrupted', ended_at=? WHERE id=? AND status='running'").run(now, str(row.id));
        if (updated.changes) this.db.prepare('INSERT INTO events VALUES (?, ?, ?, ?, ?)').run(randomUUID(), str(row.session_id), 'AgentRunInterrupted', `${str(row.agent_id)} interrupted before normal shutdown`, now);
      }
      this.db.exec('COMMIT');
    } catch (error: unknown) { this.db.exec('ROLLBACK'); throw error; }
    return pending.length;
  }
  addSnapshot(value: Snapshot): void { this.db.prepare('INSERT INTO snapshots VALUES (?, ?, ?, ?)').run(value.id, value.sessionId, value.createdAt, JSON.stringify(value.git)); }
  latestSnapshot(sessionId: string): Snapshot | null {
    const row = this.db.prepare('SELECT * FROM snapshots WHERE session_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(sessionId) as Row | undefined;
    return row ? { id: str(row.id), sessionId: str(row.session_id), createdAt: str(row.created_at), git: gitState(str(row.git_json)) } : null;
  }
  listSnapshots(sessionId: string): Snapshot[] {
    return (this.db.prepare('SELECT * FROM snapshots WHERE session_id=? ORDER BY created_at, rowid').all(sessionId) as Row[]).map((row) => ({ id: str(row.id), sessionId: str(row.session_id), createdAt: str(row.created_at), git: gitState(str(row.git_json)) }));
  }
  addRecord(value: WorkRecord): void {
    this.db.prepare('INSERT INTO work_records (id,session_id,run_id,kind,title,body,status,created_at,fork_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(value.id, value.sessionId, value.runId, value.kind, value.title, value.body, value.status, value.createdAt, value.forkId ?? null);
    this.index('record', value.id, value.sessionId, value.title, value.body);
  }
  updateRecord(value: WorkRecord): void {
    this.db.prepare('UPDATE work_records SET title=?, body=?, status=? WHERE id=?').run(value.title, value.body, value.status, value.id);
    this.db.prepare("DELETE FROM search_index WHERE source='record' AND id=?").run(value.id);
    this.index('record', value.id, value.sessionId, value.title, value.body);
  }
  deleteRecord(id: string): void {
    const previous = this.db.prepare('SELECT session_id,title FROM work_records WHERE id=?').get(id) as Row | undefined;
    this.db.prepare('DELETE FROM work_records WHERE id=?').run(id);
    this.db.prepare("DELETE FROM search_index WHERE source='record' AND id=?").run(id);
    if (previous) this.db.prepare('DELETE FROM events WHERE session_id=? AND message=?').run(str(previous.session_id), str(previous.title));
  }
  listRecords(sessionId: string): WorkRecord[] { return (this.db.prepare('SELECT * FROM work_records WHERE session_id=? ORDER BY created_at, rowid').all(sessionId) as Row[]).map(record); }
  listProjectMemory(): WorkRecord[] { return (this.db.prepare("SELECT * FROM work_records WHERE kind='memory' AND fork_id IS NULL ORDER BY created_at, rowid").all() as Row[]).map(record); }
  getRecord(id: string): WorkRecord | null { const row = this.db.prepare('SELECT * FROM work_records WHERE id=?').get(id) as Row | undefined; return row ? record(row) : null; }
  search(query: string, limit: number): SearchHit[] {
    const terms = query.match(/[\p{L}\p{N}_-]+/gu) ?? [];
    if (!terms.length) return [];
    const expression = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' OR ');
    return (this.db.prepare("SELECT source,id,session_id,title,snippet(search_index,4,'[',']','…',12) AS excerpt FROM search_index WHERE search_index MATCH ? ORDER BY rank LIMIT ?").all(expression, limit) as Row[]).map((row) => ({ source: str(row.source) as SearchHit['source'], id: str(row.id), sessionId: str(row.session_id), title: str(row.title), snippet: str(row.excerpt) }));
  }
  addFork(value: Fork): void { this.db.prepare('INSERT INTO forks VALUES (?, ?, ?, ?, ?, ?, ?)').run(value.id, value.sessionId, value.agentId, value.branch, value.path, value.baseHead, value.createdAt); }
  deleteFork(id: string): void { this.db.prepare('DELETE FROM forks WHERE id=?').run(id); }
  listForks(sessionId: string): Fork[] { return (this.db.prepare('SELECT * FROM forks WHERE session_id=? ORDER BY created_at').all(sessionId) as Row[]).map(fork); }
  scrub(patterns: readonly string[]): { updated: number; removed: number } {
    return this.transaction(() => {
      let updated = 0;
      let removed = 0;
      for (const row of this.db.prepare('SELECT id,title FROM sessions').all() as Row[]) {
        const title = redact(str(row.title));
        if (title !== row.title) { this.db.prepare('UPDATE sessions SET title=? WHERE id=?').run(title, str(row.id)); updated++; }
      }
      for (const row of this.db.prepare('SELECT id,message FROM events').all() as Row[]) {
        if (excluded(str(row.message), patterns)) { this.db.prepare('DELETE FROM events WHERE id=?').run(str(row.id)); removed++; continue; }
        const message = redact(str(row.message));
        if (message !== row.message) { this.db.prepare('UPDATE events SET message=? WHERE id=?').run(message, str(row.id)); updated++; }
      }
      for (const row of this.db.prepare('SELECT id,title,rationale FROM decisions').all() as Row[]) {
        const title = redact(str(row.title));
        const rationale = redact(str(row.rationale));
        if (title !== row.title || rationale !== row.rationale) { this.db.prepare('UPDATE decisions SET title=?, rationale=? WHERE id=?').run(title, rationale, str(row.id)); updated++; }
      }
      for (const row of this.db.prepare('SELECT id,kind,title,body FROM work_records').all() as Row[]) {
        const id = str(row.id);
        if ((row.kind === 'file' || row.kind === 'artifact') && excluded(str(row.title), patterns)) {
          this.db.prepare('DELETE FROM work_records WHERE id=?').run(id); removed++; continue;
        }
        const title = redact(str(row.title));
        const body = redact(str(row.body));
        if (title !== row.title || body !== row.body) { this.db.prepare('UPDATE work_records SET title=?,body=? WHERE id=?').run(title, body, id); updated++; }
      }
      for (const row of this.db.prepare('SELECT id,git_json FROM snapshots').all() as Row[]) {
        const git = gitState(str(row.git_json));
        const changedFiles = git.changedFiles.filter((path) => !excluded(path, patterns)).map(redact);
        if (changedFiles.length !== git.changedFiles.length || changedFiles.some((path, index) => path !== git.changedFiles[index]) || git.diff) {
          this.db.prepare('UPDATE snapshots SET git_json=? WHERE id=?').run(JSON.stringify({ ...git, changedFiles, diff: '' }), str(row.id)); updated++;
        }
      }
      this.db.prepare('DELETE FROM search_index').run();
      this.db.exec("INSERT INTO search_index (source,id,session_id,title,body) SELECT 'session',id,id,title,'' FROM sessions");
      this.db.exec("INSERT INTO search_index (source,id,session_id,title,body) SELECT 'decision',id,session_id,title,rationale FROM decisions");
      this.db.exec("INSERT INTO search_index (source,id,session_id,title,body) SELECT 'record',id,session_id,title,body FROM work_records");
      return { updated, removed };
    });
  }
  private index(source: string, id: string, sessionId: string, title: string, body: string): void { this.db.prepare('INSERT INTO search_index (source,id,session_id,title,body) VALUES (?, ?, ?, ?, ?)').run(source, id, sessionId, title, body); }
}
