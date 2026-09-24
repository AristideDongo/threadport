import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { workspace, type WorkspaceFolder } from 'vscode';
import { ThreadPort } from '../../../../src/application/threadport.js';
import type { ContextMode } from '../../../../src/domain/model.js';
import { readConfig } from '../../../../src/infrastructure/config.js';
import { GitCliReader } from '../../../../src/infrastructure/git.js';
import { loadExcludes } from '../../../../src/infrastructure/privacy.js';
import { databaseFileName, ensureProjectDir, projectDirName } from '../../../../src/infrastructure/project.js';
import { SqliteStore } from '../../../../src/infrastructure/sqlite-store.js';
import { log } from '../logging.js';
import { CachingGitReader } from '../support/caching-git-reader.js';
import { resolveContextMode } from '../support/context-mode.js';

export interface ProjectRuntime {
  readonly folder: WorkspaceFolder;
  readonly root: string;
  readonly app: ThreadPort;
  readonly store: SqliteStore;
}

export class ProjectRuntimes {
  readonly #projects = new Map<string, ProjectRuntime>();
  /** Shared by every project and by the documents, so a refresh burst runs Git once per folder. */
  readonly git = new CachingGitReader(new GitCliReader());

  isInitialized(folder: WorkspaceFolder): boolean {
    return existsSync(this.databasePath(folder));
  }

  peek(folder: WorkspaceFolder): ProjectRuntime | null {
    return this.#projects.get(folder.uri.toString()) ?? null;
  }

  get(folder: WorkspaceFolder, create = false): ProjectRuntime | null {
    const key = folder.uri.toString();
    const current = this.#projects.get(key);
    if (current) return current;

    const root = this.workspacePath(folder);
    const database = this.databasePath(folder);
    if (!existsSync(database) && !create) return null;
    ensureProjectDir(root);

    const store = new SqliteStore(database);
    const app = new ThreadPort(store, this.git, root, loadExcludes(root));
    const recovered = app.recover();
    if (recovered) log().info(`${folder.name}: recovered ${recovered} interrupted run(s).`);
    const runtime = { folder, root, app, store };
    this.#projects.set(key, runtime);
    log().info(`${folder.name}: opened ${database}`);
    return runtime;
  }

  /** Context detail level: the `threadport.context.mode` setting when set, else the project default. */
  contextMode(folder: WorkspaceFolder): ContextMode {
    const setting = workspace.getConfiguration('threadport', folder.uri).inspect<string>('context.mode');
    return resolveContextMode(setting, readConfig(this.workspacePath(folder)).context.defaultMode);
  }

  /** Redacted context pack for the active session of a project. */
  context(folder: WorkspaceFolder): string {
    const runtime = this.get(folder);
    if (!runtime) throw new Error('This project is not initialized.');
    return runtime.app.context(this.contextMode(folder), loadExcludes(runtime.root));
  }

  prune(folders: readonly WorkspaceFolder[]): void {
    const active = new Set(folders.map((folder) => folder.uri.toString()));
    for (const [key, runtime] of this.#projects) {
      if (!active.has(key)) {
        runtime.store.close();
        this.#projects.delete(key);
      }
    }
  }

  dispose(): void {
    for (const runtime of this.#projects.values()) runtime.store.close();
    this.#projects.clear();
  }

  projectDir(folder: WorkspaceFolder): string {
    return join(this.workspacePath(folder), projectDirName);
  }

  private databasePath(folder: WorkspaceFolder): string {
    return join(this.projectDir(folder), databaseFileName);
  }

  private workspacePath(folder: WorkspaceFolder): string {
    const path = folder.uri.fsPath;
    if (!path) throw new Error(`Workspace ${folder.name} does not expose a filesystem path to the extension host.`);
    return path;
  }
}
