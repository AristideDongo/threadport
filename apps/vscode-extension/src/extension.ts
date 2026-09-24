import { RelativePattern, commands, l10n, window, workspace, type Disposable, type ExtensionContext } from 'vscode';
import { AgentController } from './bootstrap/agent-controller.js';
import { ProjectRuntimes } from './bootstrap/project-runtimes.js';
import { registerCommands } from './commands/register-commands.js';
import { ThreadPortDocuments } from './documents/threadport-documents.js';
import { registerChatParticipant } from './integrations/chat.js';
import { registerMcpServers } from './integrations/mcp.js';
import { log, report } from './logging.js';
import { SessionStatus } from './status-bar/session-status.js';
import { debounce } from './support/debounce.js';
import { SessionsTree, type SessionsNode } from './views/sessions-tree.js';
import { VSCodeTerminalAgentRunner } from './vscode-adapters/terminal-agent-runner.js';
import { workspaceFolders } from './vscode-adapters/workspace-projects.js';

/** Watches each folder's ThreadPort database so changes made by the CLI, hooks or MCP show up here. */
function watchDatabases(onChange: () => void): Disposable {
  let watchers: Disposable[] = [];
  const watch = () => {
    for (const watcher of watchers) watcher.dispose();
    watchers = workspaceFolders().map((folder) => {
      const watcher = workspace.createFileSystemWatcher(new RelativePattern(folder, '.threadport/threadport.sqlite*'));
      watcher.onDidCreate(onChange);
      watcher.onDidChange(onChange);
      watcher.onDidDelete(onChange);
      return watcher;
    });
  };
  watch();
  const folders = workspace.onDidChangeWorkspaceFolders(watch);
  return {
    dispose: () => {
      folders.dispose();
      for (const watcher of watchers) watcher.dispose();
    },
  };
}

export function activate(context: ExtensionContext): void {
  log().info(`ThreadPort ${String(context.extension.packageJSON.version)} activated (trusted: ${workspace.isTrusted})`);
  const projects = new ProjectRuntimes();
  const tree = new SessionsTree(projects);
  const status = new SessionStatus(projects);
  const runner = new VSCodeTerminalAgentRunner();
  let documents: ThreadPortDocuments | undefined;
  const mcp = registerMcpServers(context, projects);
  const refresh = (): void => {
    projects.git.invalidate();
    tree.refresh();
    status.refresh();
    documents?.refresh();
  };
  const agents = new AgentController(projects, runner, refresh);
  documents = new ThreadPortDocuments(projects, agents, refresh, context.workspaceState);
  const treeView = window.createTreeView<SessionsNode>('threadport.sessions', {
    treeDataProvider: tree,
    showCollapseAll: true,
  });
  // SQLite writes touch the database and its WAL several times per change.
  const externalChange = debounce(() => {
    mcp.refresh();
    refresh();
  }, 300);

  context.subscriptions.push(
    log(),
    treeView,
    status,
    runner,
    documents,
    mcp.disposable,
    registerChatParticipant(projects),
    watchDatabases(externalChange),
    { dispose: () => externalChange.cancel() },
    workspace.onDidChangeWorkspaceFolders(() => {
      projects.prune(workspace.workspaceFolders ?? []);
      mcp.refresh();
      refresh();
    }),
    workspace.onDidSaveTextDocument(() => projects.git.invalidate()),
    workspace.onDidGrantWorkspaceTrust(refresh),
    workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('threadport')) refresh();
    }),
    treeView.onDidChangeCheckboxState((event) => {
      for (const [node] of event.items) {
        if (node.kind !== 'task' || node.task.status === 'done') continue;
        try {
          const runtime = projects.get(node.folder);
          runtime?.app.open(node.session.id);
          runtime?.app.completeTask(node.task.id);
        } catch (error: unknown) {
          void window.showErrorMessage(`ThreadPort: ${report(error, 'Complete task')}`);
        }
      }
      refresh();
    }),
    ...registerCommands(projects, documents, () => {
      agents.invalidate();
      refresh();
    }),
    commands.registerCommand('threadport.showLogs', () => log().show()),
    { dispose: () => projects.dispose() },
  );
  if (!workspace.isTrusted)
    log().info(
      l10n.t('Restricted mode: agents and verification commands are disabled until the workspace is trusted.'),
    );
}

export function deactivate(): void {}
