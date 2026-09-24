import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkspaceFolder } from 'vscode';
import { ThreadPort } from '../../../../src/application/threadport.js';
import { GitCliReader } from '../../../../src/infrastructure/git.js';
import { loadExcludes } from '../../../../src/infrastructure/privacy.js';
import { ensureProjectDir } from '../../../../src/infrastructure/project.js';
import { SqliteStore } from '../../../../src/infrastructure/sqlite-store.js';

export interface ProjectRuntime {
  readonly folder: WorkspaceFolder;
  readonly app: ThreadPort;
  readonly store: SqliteStore;
}

export class ProjectRuntimes {
  readonly #projects = new Map<string, ProjectRuntime>();

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
    if (create || existsSync(database)) ensureProjectDir(root);

    const store = new SqliteStore(database);
    const app = new ThreadPort(store, new GitCliReader(), root, loadExcludes(root));
    app.recover();
    const runtime = { folder, app, store };
    this.#projects.set(key, runtime);
    return runtime;
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

  private databasePath(folder: WorkspaceFolder): string {
    return join(this.workspacePath(folder), '.threadport', 'threadport.sqlite');
  }

  private workspacePath(folder: WorkspaceFolder): string {
    const path = folder.uri.fsPath;
    if (!path) throw new Error(`Workspace ${folder.name} does not expose a filesystem path to the extension host.`);
    return path;
  }
}
