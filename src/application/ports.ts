import type {
  AgentRun,
  Decision,
  Fork,
  GitState,
  SearchHit,
  Session,
  Snapshot,
  TimelineEvent,
  WorkRecord,
} from '../domain/model.js';

export interface SessionStore {
  transaction<T>(work: () => T): T;
  createSession(session: Session): void;
  updateSession(session: Session): void;
  deleteSession(id: string): void;
  getSession(id: string): Session | null;
  listSessions(): Session[];
  getActiveSession(): Session | null;
  addEvent(event: TimelineEvent): void;
  listEvents(sessionId: string): TimelineEvent[];
  addDecision(decision: Decision): void;
  listDecisions(sessionId: string): Decision[];
  addRun(run: AgentRun): void;
  updateRun(run: AgentRun): void;
  setProviderSessionId(runId: string, providerSessionId: string): void;
  listRuns(sessionId: string): AgentRun[];
  recoverRuns(now: string): number;
  addSnapshot(snapshot: Snapshot): void;
  latestSnapshot(sessionId: string): Snapshot | null;
  listSnapshots(sessionId: string): Snapshot[];
  addRecord(record: WorkRecord): void;
  updateRecord(record: WorkRecord): void;
  deleteRecord(id: string): void;
  listRecords(sessionId: string): WorkRecord[];
  listProjectMemory(): WorkRecord[];
  getRecord(id: string): WorkRecord | null;
  search(query: string, limit: number): SearchHit[];
  addFork(fork: Fork): void;
  deleteFork(id: string): void;
  listForks(sessionId: string): Fork[];
  scrub(patterns: readonly string[]): { updated: number; removed: number };
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
  structuredArgs?(contextFile: string): string[];
  resumeArgs?(providerSessionId: string, contextFile: string): string[];
}

export interface AgentRunner {
  available(command: string): boolean;
  run(command: string, args: string[], cwd: string): Promise<number>;
}

export interface CommandResult {
  code: number;
  output: string;
}
export interface CommandExecutor {
  execute(command: string, args: string[], cwd: string): Promise<CommandResult>;
}
