import { commands, window, type Disposable, type QuickPickItem, type WorkspaceFolder } from 'vscode';
import type { Session } from '../../../../src/domain/model.js';
import type { ProjectRuntimes } from '../bootstrap/project-runtimes.js';
import type { DetailNode, ProjectNode, SessionNode, UninitializedNode } from '../views/sessions-tree.js';
import type { SessionsTree } from '../views/sessions-tree.js';
import type { SessionStatus } from '../status-bar/session-status.js';
import { selectWorkspaceFolder, workspaceFolders } from '../vscode-adapters/workspace-projects.js';
import type { SessionPages } from '../webviews/session-pages.js';

interface SessionPick extends QuickPickItem {
  readonly folder: WorkspaceFolder;
  readonly session: Session;
}

type ProjectArgument = ProjectNode | UninitializedNode;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function safely(work: () => Promise<void> | void): Promise<void> {
  try {
    await work();
  } catch (error: unknown) {
    await window.showErrorMessage(`ThreadPort: ${errorMessage(error)}`);
  }
}

function refresh(tree: SessionsTree, status: SessionStatus): void {
  tree.refresh();
  status.refresh();
}

async function selectSession(projects: ProjectRuntimes): Promise<SessionNode | undefined> {
  const picks: SessionPick[] = [];
  for (const folder of workspaceFolders()) {
    const runtime = projects.get(folder);
    if (!runtime) continue;
    for (const session of runtime.app.sessions()) {
      picks.push({ label: session.title, description: `${folder.name} · ${session.status}`, folder, session });
    }
  }
  const pick = await window.showQuickPick(picks, { placeHolder: 'Select a ThreadPort session' });
  return pick ? { kind: 'session', folder: pick.folder, session: pick.session } : undefined;
}

export function registerCommands(projects: ProjectRuntimes, tree: SessionsTree, status: SessionStatus, pages: SessionPages): readonly Disposable[] {
  const initialize = commands.registerCommand('threadport.initializeProject', (argument?: ProjectArgument) => safely(async () => {
    const folder = argument?.folder ?? await selectWorkspaceFolder('Select a project to initialize');
    if (!folder) return;
    const alreadyInitialized = projects.isInitialized(folder);
    projects.get(folder, true);
    refresh(tree, status);
    pages.refresh();
    await window.showInformationMessage(alreadyInitialized ? `${folder.name} is already initialized.` : `ThreadPort initialized for ${folder.name}.`);
  }));

  const create = commands.registerCommand('threadport.newSession', () => pages.openNewSession());

  const openPage = commands.registerCommand('threadport.openSessionPage', (node?: SessionNode | DetailNode) => safely(async () => {
    const selected = node ?? await selectSession(projects);
    if (!selected) return;
    pages.open(selected.folder, selected.session.id, selected.kind === 'detail' ? selected.section : 'overview');
  }));

  const open = commands.registerCommand('threadport.openSession', (node?: SessionNode) => safely(async () => {
    let selected = node;
    if (!selected) selected = await selectSession(projects);
    if (!selected) return;
    const runtime = projects.get(selected.folder);
    if (!runtime) throw new Error('The selected project is not initialized.');
    runtime.app.open(selected.session.id);
    refresh(tree, status);
    pages.open(selected.folder, selected.session.id, 'overview');
  }));

  const refreshCommand = commands.registerCommand('threadport.refresh', () => {
    refresh(tree, status);
    pages.refresh();
  });
  return [initialize, create, openPage, open, refreshCommand];
}
