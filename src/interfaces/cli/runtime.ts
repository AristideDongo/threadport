import { InvalidArgumentError } from 'commander';
import { existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { assertMode } from '../../domain/model.js';
import { ThreadPort } from '../../application/threadport.js';
import { loadExcludes } from '../../infrastructure/privacy.js';
import { SqliteStore } from '../../infrastructure/sqlite-store.js';
import { GitCliReader } from '../../infrastructure/git.js';
import { GitWorktrees } from '../../infrastructure/git-worktrees.js';
import { adapterById, adapters, TerminalAgentRunner } from '../../infrastructure/agents.js';
import { assertTrusted, loadAgentPlugins } from '../../infrastructure/agent-plugins.js';
import { databaseFileName, ensureProjectDir, findProjectRoot, projectDirName } from '../../infrastructure/project.js';

/** Directory the user invoked the CLI from. */
export const invocationDir = process.cwd();
/** Closest initialized project at or above the invocation directory, so commands also work from subdirectories. */
export const cwd = findProjectRoot(invocationDir) ?? invocationDir;
export const projectDir = join(cwd, projectDirName);
export const dbPath = join(projectDir, databaseFileName);
export const git = new GitCliReader();
export const runner = new TerminalAgentRunner();
export const worktrees = new GitWorktrees();
export const knownAgents = () => [...adapters, ...loadAgentPlugins(projectDir)];
/** Resolves an agent that is allowed to run; untrusted project manifests are rejected. */
export function findAgent(id: string) {
  const agent = adapterById(id, loadAgentPlugins(projectDir));
  assertTrusted(agent);
  return agent;
}

/** Converts a path typed from a subdirectory into a project-relative path. */
export function projectPath(path: string): string {
  if (invocationDir === cwd) return path;
  const value = relative(cwd, resolve(invocationDir, path));
  return value && value !== '..' && !value.startsWith(`..${sep}`) ? value.replaceAll('\\', '/') : path;
}

export function project(root = cwd, create = false): { app: ThreadPort; store: SqliteStore } {
  const database = join(root, projectDirName, databaseFileName);
  if (!create && !existsSync(database)) throw new Error('Project is not initialized. Run "threadport init".');
  ensureProjectDir(root);
  const store = new SqliteStore(database);
  const app = new ThreadPort(store, git, root, loadExcludes(root));
  const recovered = app.recover();
  if (recovered) console.error(`↺ Recovered ${recovered} interrupted run(s).`);
  return { app, store };
}

export function withProject(action: (app: ThreadPort) => void): void {
  const { app, store } = project();
  try {
    action(app);
  } finally {
    store.close();
  }
}

export async function withProjectAsync(action: (app: ThreadPort) => Promise<void>): Promise<void> {
  const { app, store } = project();
  try {
    await action(app);
  } finally {
    store.close();
  }
}

export function requireActive(app: ThreadPort) {
  const session = app.active();
  if (!session) throw new Error('No active session. Run "threadport new <objective>".');
  return session;
}

export function contextMode(value: string) {
  try {
    return assertMode(value);
  } catch (error: unknown) {
    throw new InvalidArgumentError(error instanceof Error ? error.message : String(error));
  }
}
