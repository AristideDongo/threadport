import { window, workspace, type ExtensionContext } from 'vscode';
import { ProjectRuntimes } from './bootstrap/project-runtimes.js';
import { registerCommands } from './commands/register-commands.js';
import { SessionStatus } from './status-bar/session-status.js';
import { SessionsTree } from './views/sessions-tree.js';

export function activate(context: ExtensionContext): void {
  const projects = new ProjectRuntimes();
  const tree = new SessionsTree(projects);
  const status = new SessionStatus(projects);
  const treeView = window.createTreeView('threadport.sessions', { treeDataProvider: tree, showCollapseAll: true });
  const workspaceChanges = workspace.onDidChangeWorkspaceFolders(() => {
    projects.prune(workspace.workspaceFolders ?? []);
    tree.refresh();
    status.refresh();
  });

  context.subscriptions.push(
    treeView,
    status,
    workspaceChanges,
    ...registerCommands(projects, tree, status),
    { dispose: () => projects.dispose() }
  );
}

export function deactivate(): void {}
