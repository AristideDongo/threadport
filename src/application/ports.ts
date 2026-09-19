import type { AgentRun, Decision, GitState, Session, Snapshot, TimelineEvent } from '../domain/model.js';

export interface SessionStore {
  createSession(session: Session): void;
  updateSession(session: Session): void;
  getSession(id: string): Session | null;
  listSessions(): Session[];
  getActiveSession(): Session | null;
  addEvent(event: TimelineEvent): void;
  listEvents(sessionId: string): TimelineEvent[];
  addDecision(decision: Decision): void;
  listDecisions(sessionId: string): Decision[];
  addRun(run: AgentRun): void;
  updateRun(run: AgentRun): void;
  listRuns(sessionId: string): AgentRun[];
  recoverRuns(now: string): number;
  addSnapshot(snapshot: Snapshot): void;
  latestSnapshot(sessionId: string): Snapshot | null;
}

export interface GitReader {
  read(cwd: string): GitState | null;
}

export interface AgentAdapter {
  readonly id: string;
  readonly label: string;
  readonly command: string;
  readonly capabilities: readonly string[];
  args(contextFile: string): string[];
}

export interface AgentRunner {
  available(command: string): boolean;
  run(command: string, args: string[], cwd: string): Promise<number>;
}
