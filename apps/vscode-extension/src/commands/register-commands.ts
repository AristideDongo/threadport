import { commands, window, type Disposable, type QuickPickItem, type WorkspaceFolder } from 'vscode';
import type { Session } from '../../../../src/domain/model.js';
import type { ProjectRuntimes } from '../bootstrap/project-runtimes.js';
import type { ProjectNode, SessionNode, UninitializedNode } from '../views/sessions-tree.js';
import type { SessionsTree } from '../views/sessions-tree.js';
import type { SessionStatus } from '../status-bar/session-status.js';
import { selectWorkspaceFolder, workspaceFolders } from '../vscode-adapters/workspace-projects.js';

interface AgentPick extends QuickPickItem {
  readonly id: 'claude' | 'codex' | 'gemini' | 'opencode' | null;
}

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

export function registerCommands(projects: ProjectRuntimes, tree: SessionsTree, status: SessionStatus): readonly Disposable[] {
  const initialize = commands.registerCommand('threadport.initializeProject', (argument?: ProjectArgument) => safely(async () => {
    const folder = argument?.folder ?? await selectWorkspaceFolder('Select a project to initialize');
    if (!folder) return;
    const alreadyInitialized = projects.isInitialized(folder);
    projects.get(folder, true);
    refresh(tree, status);
    await window.showInformationMessage(alreadyInitialized ? `${folder.name} is already initialized.` : `ThreadPort initialized for ${folder.name}.`);
  }));

  const create = commands.registerCommand('threadport.newSession', () => safely(async () => {
    const folder = await selectWorkspaceFolder('Select the project for this session');
    if (!folder) return;
    const objective = await window.showInputBox({
      title: 'ThreadPort: New Session',
      prompt: 'What should this development session accomplish?',
      placeHolder: 'Implement refresh-token rotation',
      ignoreFocusOut: true,
      validateInput: (value) => {
        const length = value.trim().length;
        if (length === 0) return 'Enter a session objective.';
        if (length > 200) return 'Use 200 characters or fewer.';
        return undefined;
      }
    });
    if (!objective) return;

    const agents: readonly AgentPick[] = [
      { label: 'None', description: 'Choose an agent later', id: null },
      { label: 'Claude Code', id: 'claude' },
      { label: 'OpenAI Codex', id: 'codex' },
      { label: 'Gemini CLI', id: 'gemini' },
      { label: 'OpenCode', id: 'opencode' }
    ];
    const agent = await window.showQuickPick(agents, {
      title: 'ThreadPort: Initial Agent',
      placeHolder: 'Select an optional initial agent',
      ignoreFocusOut: true
    });
    if (!agent) return;

    const runtime = projects.get(folder, true);
    if (!runtime) throw new Error('Could not initialize the selected project.');
    const session = runtime.app.newSession(objective);
    if (agent.id) runtime.app.addRecord('note', 'Initial agent', agent.id);
    refresh(tree, status);
    await window.showInformationMessage(`Session created: ${session.title}`);
  }));

  const open = commands.registerCommand('threadport.openSession', (node?: SessionNode) => safely(async () => {
    let selected = node;
    if (!selected) {
      const picks: SessionPick[] = [];
      for (const folder of workspaceFolders()) {
        const runtime = projects.get(folder);
        if (!runtime) continue;
        for (const session of runtime.app.sessions()) {
          picks.push({ label: session.title, description: `${folder.name} · ${session.status}`, folder, session });
        }
      }
      const pick = await window.showQuickPick(picks, { placeHolder: 'Select a ThreadPort session' });
      if (!pick) return;
      selected = { kind: 'session', folder: pick.folder, session: pick.session };
    }
    const runtime = projects.get(selected.folder);
    if (!runtime) throw new Error('The selected project is not initialized.');
    runtime.app.open(selected.session.id);
    refresh(tree, status);
    await window.showInformationMessage(`Active session: ${selected.session.title}`);
  }));

  const refreshCommand = commands.registerCommand('threadport.refresh', () => refresh(tree, status));
  return [initialize, create, open, refreshCommand];
}
