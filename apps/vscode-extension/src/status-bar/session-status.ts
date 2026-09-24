import {
  StatusBarAlignment,
  l10n,
  window,
  workspace,
  type Disposable,
  type StatusBarItem,
  type WorkspaceFolder,
} from 'vscode';
import type { ProjectRuntimes } from '../bootstrap/project-runtimes.js';
import { workspaceFolders } from '../vscode-adapters/workspace-projects.js';

/** The folder of the active editor, else the first folder with an active session, else the first folder. */
export function currentFolder(projects: ProjectRuntimes): WorkspaceFolder | undefined {
  const uri = window.activeTextEditor?.document.uri;
  const query = uri?.scheme === 'threadport' ? new URLSearchParams(uri.query).get('folder') : null;
  const fromEditor = query
    ? workspaceFolders().find((folder) => folder.uri.toString() === query)
    : uri && workspace.getWorkspaceFolder(uri);
  if (fromEditor) return fromEditor;
  return workspaceFolders().find((folder) => projects.peek(folder)?.app.active()) ?? workspaceFolders()[0];
}

export class SessionStatus implements Disposable {
  readonly #item: StatusBarItem = window.createStatusBarItem('threadport.session', StatusBarAlignment.Left, 50);
  readonly #editorChanges: Disposable;

  constructor(private readonly projects: ProjectRuntimes) {
    this.#item.name = l10n.t('ThreadPort session');
    this.#item.command = 'threadport.showMenu';
    this.#editorChanges = window.onDidChangeActiveTextEditor(() => this.refresh());
    this.refresh();
    this.#item.show();
  }

  refresh(): void {
    const folder = currentFolder(this.projects);
    const runtime = folder ? this.projects.peek(folder) : null;
    const active = runtime?.app.active();
    if (!folder || !active) {
      this.#item.text = '$(hubot) ThreadPort';
      this.#item.tooltip = folder
        ? l10n.t('{0}: no active ThreadPort session', folder.name)
        : l10n.t('No active ThreadPort session');
      return;
    }
    const run = runtime?.app.runs(active.id).findLast((candidate) => candidate.status === 'running');
    this.#item.text = run ? `$(loading~spin) ThreadPort: ${run.agentId}` : `$(hubot) ThreadPort: ${active.title}`;
    this.#item.tooltip = run
      ? l10n.t('{0} · {1} · agent running', folder.name, active.id)
      : `${folder.name} · ${active.id}`;
  }

  dispose(): void {
    this.#editorChanges.dispose();
    this.#item.dispose();
  }
}
