import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentRun, Decision, GitState, Session, Snapshot, TimelineEvent } from '../domain/model.js';
import type { SessionStore } from '../application/ports.js';

type Row = Record<string, unknown>;
function str(value: unknown): string { if (typeof value !== 'string') throw new Error('Données SQLite invalides.'); return value; }
function nullableStr(value: unknown): string | null { return value === null ? null : str(value); }
function nullableNum(value: unknown): number | null { if (value === null) return null; if (typeof value !== 'number') throw new Error('Données SQLite invalides.'); return value; }
function session(row: Row): Session { return { id: str(row.id), title: str(row.title), status: str(row.status) as Session['status'], createdAt: str(row.created_at), updatedAt: str(row.updated_at) }; }
function run(row: Row): AgentRun { return { id: str(row.id), sessionId: str(row.session_id), agentId: str(row.agent_id), status: str(row.status) as AgentRun['status'], startedAt: str(row.started_at), endedAt: nullableStr(row.ended_at), exitCode: nullableNum(row.exit_code) }; }
function event(row: Row): TimelineEvent { return { id: str(row.id), sessionId: str(row.session_id), type: str(row.type), message: str(row.message), createdAt: str(row.created_at) }; }
function decision(row: Row): Decision { return { id: str(row.id), sessionId: str(row.session_id), title: str(row.title), rationale: str(row.rationale), createdAt: str(row.created_at) }; }
function gitState(raw: string): GitState {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== 'object' || value === null || !('changedFiles' in value) || !Array.isArray(value.changedFiles)) throw new Error('Snapshot Git invalide.');
  return value as GitState;
}

export class SqliteStore implements SessionStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    const version = this.db.prepare('PRAGMA user_version').get() as Row | undefined;
    if (version && Number(version.user_version) > 1) throw new Error('Base créée par une version plus récente de ThreadPort.');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), agent_id TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, exit_code INTEGER);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), type TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), title TEXT NOT NULL, rationale TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), created_at TEXT NOT NULL, git_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_session ON events(session_id, created_at);
      CREATE INDEX IF NOT EXISTS runs_session ON runs(session_id, started_at);
      PRAGMA user_version = 1;
    `);
  }
  close(): void { this.db.close(); }
  createSession(value: Session): void { this.db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)').run(value.id, value.title, value.status, value.createdAt, value.updatedAt); }
  updateSession(value: Session): void { this.db.prepare('UPDATE sessions SET title=?, status=?, updated_at=? WHERE id=?').run(value.title, value.status, value.updatedAt, value.id); }
  getSession(id: string): Session | null { const row = this.db.prepare('SELECT * FROM sessions WHERE id=?').get(id) as Row | undefined; return row ? session(row) : null; }
  listSessions(): Session[] { return (this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as Row[]).map(session); }
  getActiveSession(): Session | null { const row = this.db.prepare("SELECT * FROM sessions WHERE status='active' ORDER BY updated_at DESC LIMIT 1").get() as Row | undefined; return row ? session(row) : null; }
  addEvent(value: TimelineEvent): void { this.db.prepare('INSERT INTO events VALUES (?, ?, ?, ?, ?)').run(value.id, value.sessionId, value.type, value.message, value.createdAt); }
  listEvents(sessionId: string): TimelineEvent[] { return (this.db.prepare('SELECT * FROM events WHERE session_id=? ORDER BY created_at, rowid').all(sessionId) as Row[]).map(event); }
  addDecision(value: Decision): void { this.db.prepare('INSERT INTO decisions VALUES (?, ?, ?, ?, ?)').run(value.id, value.sessionId, value.title, value.rationale, value.createdAt); }
  listDecisions(sessionId: string): Decision[] { return (this.db.prepare('SELECT * FROM decisions WHERE session_id=? ORDER BY created_at').all(sessionId) as Row[]).map(decision); }
  addRun(value: AgentRun): void { this.db.prepare('INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, ?)').run(value.id, value.sessionId, value.agentId, value.status, value.startedAt, value.endedAt, value.exitCode); }
  updateRun(value: AgentRun): void { this.db.prepare('UPDATE runs SET status=?, ended_at=?, exit_code=? WHERE id=?').run(value.status, value.endedAt, value.exitCode, value.id); }
  listRuns(sessionId: string): AgentRun[] { return (this.db.prepare('SELECT * FROM runs WHERE session_id=? ORDER BY started_at, rowid').all(sessionId) as Row[]).map(run); }
  recoverRuns(now: string): number {
    const pending = this.db.prepare("SELECT id, session_id, agent_id FROM runs WHERE status='running'").all() as Row[];
    this.db.exec('BEGIN');
    try {
      for (const row of pending) {
        this.db.prepare("UPDATE runs SET status='interrupted', ended_at=? WHERE id=?").run(now, str(row.id));
        this.db.prepare('INSERT INTO events VALUES (?, ?, ?, ?, ?)').run(randomUUID(), str(row.session_id), 'AgentRunInterrupted', `${str(row.agent_id)} interrompu avant la fermeture normale`, now);
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
}
