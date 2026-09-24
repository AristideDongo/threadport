import { window, workspace, type ExtensionContext } from 'vscode';
import { ProjectRuntimes } from './bootstrap/project-runtimes.js';
import { AgentController } from './bootstrap/agent-controller.js';
import { registerCommands } from './commands/register-commands.js';
import { ThreadPortDocuments } from './documents/threadport-documents.js';
import { SessionStatus } from './status-bar/session-status.js';
import { SessionsTree } from './views/sessions-tree.js';
import { VSCodeTerminalAgentRunner } from './vscode-adapters/terminal-agent-runner.js';

export function activate(context: ExtensionContext): void {
  const projects = new ProjectRuntimes();
  const tree = new SessionsTree(projects);
  const status = new SessionStatus(projects);
  const runner = new VSCodeTerminalAgentRunner();
  let documents: ThreadPortDocuments | undefined;
  const refresh = (): void => {
    tree.refresh();
    status.refresh();
    documents?.refresh();
  };
  const agents = new AgentController(projects, runner, refresh);
  documents = new ThreadPortDocuments(projects, agents, refresh);
  const treeView = window.createTreeView('threadport.sessions', { treeDataProvider: tree, showCollapseAll: true });
  const workspaceChanges = workspace.onDidChangeWorkspaceFolders(() => {
    projects.prune(workspace.workspaceFolders ?? []);
    refresh();
  });

  context.subscriptions.push(
    treeView,
    status,
    runner,
    documents,
    workspaceChanges,
    ...registerCommands(projects, tree, status, documents),
    { dispose: () => projects.dispose() },
  );
}

export function deactivate(): void {}
