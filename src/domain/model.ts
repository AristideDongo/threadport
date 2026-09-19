export type SessionStatus = 'active' | 'paused' | 'done';
export type RunStatus = 'running' | 'completed' | 'failed' | 'interrupted';
export type ContextMode = 'minimal' | 'standard' | 'deep' | 'full';

export interface Session {
  id: string;
  title: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRun {
  id: string;
  sessionId: string;
  agentId: string;
  status: RunStatus;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
}

export interface TimelineEvent {
  id: string;
  sessionId: string;
  type: string;
  message: string;
  createdAt: string;
}

export interface Decision {
  id: string;
  sessionId: string;
  title: string;
  rationale: string;
  createdAt: string;
}

export interface GitState {
  branch: string | null;
  head: string | null;
  changedFiles: string[];
  diff: string;
}

export interface Snapshot {
  id: string;
  sessionId: string;
  createdAt: string;
  git: GitState;
}

export function assertTitle(title: string): string {
  const value = title.trim();
  if (!value || value.length > 200) throw new Error('Le titre doit contenir entre 1 et 200 caractères.');
  return value;
}

export function assertMode(value: string): ContextMode {
  if (value === 'minimal' || value === 'standard' || value === 'deep' || value === 'full') return value;
  throw new Error(`Mode inconnu : ${value}. Choisissez minimal, standard, deep ou full.`);
}
