import {
  EventEmitter,
  ThemeIcon,
  TreeItem,
  TreeItemCheckboxState,
  TreeItemCollapsibleState,
  l10n,
  workspace,
  type Event,
  type TreeDataProvider,
  type WorkspaceFolder,
} from 'vscode';
import type { Session, WorkRecord } from '../../../../src/domain/model.js';
import type { ProjectRuntimes } from '../bootstrap/project-runtimes.js';
import type { NativeSessionSection } from '../documents/threadport-documents.js';

export interface ProjectNode {
  readonly kind: 'project';
  readonly folder: WorkspaceFolder;
}
export interface SessionNode {
  readonly kind: 'session';
  readonly folder: WorkspaceFolder;
  readonly session: Session;
}
export interface DetailNode {
  readonly kind: 'detail';
  readonly label: string;
  readonly description: string;
  readonly icon: string;
  readonly folder: WorkspaceFolder;
  readonly session: Session;
  readonly section: NativeSessionSection;
}
export interface UninitializedNode {
  readonly kind: 'uninitialized';
  readonly folder: WorkspaceFolder;
}
export interface TasksNode {
  readonly kind: 'tasks';
  readonly folder: WorkspaceFolder;
  readonly session: Session;
}
export interface TaskNode {
  readonly kind: 'task';
  readonly folder: WorkspaceFolder;
  readonly session: Session;
  readonly task: WorkRecord;
}
interface MessageNode {
  readonly kind: 'message';
  readonly label: string;
  readonly icon: string;
}
export type SessionsNode =
  | ProjectNode
  | SessionNode
  | DetailNode
  | TasksNode
  | TaskNode
  | UninitializedNode
  | MessageNode;

export class SessionsTree implements TreeDataProvider<SessionsNode> {
  readonly #changes = new EventEmitter<SessionsNode | undefined | null>();
  readonly onDidChangeTreeData: Event<SessionsNode | undefined | null> = this.#changes.event;

  constructor(private readonly projects: ProjectRuntimes) {}

  refresh(): void {
    this.#changes.fire(undefined);
  }

  getTreeItem(node: SessionsNode): TreeItem {
    if (node.kind === 'project') {
      const item = new TreeItem(node.folder.name, TreeItemCollapsibleState.Expanded);
      item.description = node.folder.uri.fsPath;
      item.iconPath = new ThemeIcon('repo');
      item.contextValue = 'threadport.project';
      return item;
    }
    if (node.kind === 'session') {
      const item = new TreeItem(node.session.title, TreeItemCollapsibleState.Collapsed);
      item.description = `${node.session.id} · ${node.session.status}`;
      item.iconPath = new ThemeIcon(
        node.session.status === 'active'
          ? 'circle-filled'
          : node.session.status === 'done'
            ? 'pass-filled'
            : 'circle-outline',
      );
      // Menus match /^threadport\.session/ and can target a status, e.g. hide "Finish" on finished sessions.
      item.contextValue = `threadport.session.${node.session.status}`;
      item.command = { command: 'threadport.openSessionPage', title: 'View Session', arguments: [node] };
      return item;
    }
    if (node.kind === 'tasks') {
      const tasks = this.tasks(node);
      const open = tasks.filter((task) => task.status !== 'done').length;
      const item = new TreeItem(
        l10n.t('Tasks'),
        tasks.length ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None,
      );
      item.description = l10n.t('{0} open', open);
      item.iconPath = new ThemeIcon('checklist');
      return item;
    }
    if (node.kind === 'task') {
      const item = new TreeItem(node.task.title, TreeItemCollapsibleState.None);
      item.id = `${node.folder.uri.toString()}::task::${node.task.id}`;
      item.description = node.task.id;
      // Checking an open task completes it; the store has no "reopen", so done tasks stay checked.
      item.checkboxState =
        node.task.status === 'done'
          ? { state: TreeItemCheckboxState.Checked, tooltip: l10n.t('Completed') }
          : { state: TreeItemCheckboxState.Unchecked, tooltip: l10n.t('Mark as completed') };
      item.contextValue = 'threadport.task';
      return item;
    }
    if (node.kind === 'uninitialized') {
      const item = new TreeItem(l10n.t('Initialize ThreadPort'), TreeItemCollapsibleState.None);
      item.description = l10n.t('Create local project storage');
      item.iconPath = new ThemeIcon('database');
      item.contextValue = 'threadport.uninitialized';
      item.command = { command: 'threadport.initializeProject', title: 'Initialize Project', arguments: [node] };
      return item;
    }
    const item = new TreeItem(node.label, TreeItemCollapsibleState.None);
    if (node.kind === 'detail') {
      item.description = node.description;
      item.command = { command: 'threadport.openSessionPage', title: `View ${node.label}`, arguments: [node] };
    }
    item.iconPath = new ThemeIcon(node.icon);
    return item;
  }

  getChildren(node?: SessionsNode): SessionsNode[] {
    if (!node) {
      const folders = workspace.workspaceFolders ?? [];
      if (folders.length === 0)
        return [{ kind: 'message', label: l10n.t('Open a project folder to start'), icon: 'folder-opened' }];
      return folders.map((folder) => ({ kind: 'project', folder }));
    }
    if (node.kind === 'project') {
      const runtime = this.projects.get(node.folder);
      if (!runtime) return [{ kind: 'uninitialized', folder: node.folder }];
      const sessions = runtime.app.sessions();
      if (sessions.length === 0) return [{ kind: 'message', label: l10n.t('No sessions yet'), icon: 'info' }];
      return sessions.map((session) => ({ kind: 'session', folder: node.folder, session }));
    }
    if (node.kind === 'session') {
      const runtime = this.projects.get(node.folder);
      if (!runtime) return [];
      const runs = runtime.app.runs(node.session.id);
      const records = runtime.app.records(node.session.id);
      const decisions = runtime.app.decisions(node.session.id);
      const lastRun = runs.at(-1);
      const preferredAgent = records.findLast(
        (record) => record.kind === 'note' && record.title === 'Initial agent',
      )?.body;
      return [
        { kind: 'tasks', folder: node.folder, session: node.session },
        {
          kind: 'detail',
          label: l10n.t('Agent'),
          description: lastRun?.agentId ?? preferredAgent ?? l10n.t('None'),
          icon: 'hubot',
          folder: node.folder,
          session: node.session,
          section: 'agent',
        },
        {
          kind: 'detail',
          label: l10n.t('Relevant files'),
          description: String(records.filter((record) => record.kind === 'file').length),
          icon: 'files',
          folder: node.folder,
          session: node.session,
          section: 'files',
        },
        {
          kind: 'detail',
          label: l10n.t('Decisions'),
          description: String(decisions.length),
          icon: 'lightbulb',
          folder: node.folder,
          session: node.session,
          section: 'decisions',
        },
        {
          kind: 'detail',
          label: l10n.t('Runs'),
          description: String(runs.length),
          icon: 'history',
          folder: node.folder,
          session: node.session,
          section: 'runs',
        },
      ];
    }
    if (node.kind === 'tasks')
      return this.tasks(node).map((task) => ({ kind: 'task', folder: node.folder, session: node.session, task }));
    return [];
  }

  private tasks(node: TasksNode): WorkRecord[] {
    return (
      this.projects
        .get(node.folder)
        ?.app.records(node.session.id)
        .filter((record) => record.kind === 'task') ?? []
    );
  }
}
