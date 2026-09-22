import {
  EventEmitter,
  ThemeIcon,
  TreeItem,
  TreeItemCollapsibleState,
  workspace,
  type Event,
  type TreeDataProvider,
  type WorkspaceFolder
} from 'vscode';
import type { Session } from '../../../../src/domain/model.js';
import type { ProjectRuntimes } from '../bootstrap/project-runtimes.js';

export interface ProjectNode { readonly kind: 'project'; readonly folder: WorkspaceFolder }
export interface SessionNode { readonly kind: 'session'; readonly folder: WorkspaceFolder; readonly session: Session }
interface DetailNode { readonly kind: 'detail'; readonly label: string; readonly description: string; readonly icon: string }
export interface UninitializedNode { readonly kind: 'uninitialized'; readonly folder: WorkspaceFolder }
interface MessageNode { readonly kind: 'message'; readonly label: string; readonly icon: string }
export type SessionsNode = ProjectNode | SessionNode | DetailNode | UninitializedNode | MessageNode;

export class SessionsTree implements TreeDataProvider<SessionsNode> {
  readonly #changes = new EventEmitter<SessionsNode | undefined | null | void>();
  readonly onDidChangeTreeData: Event<SessionsNode | undefined | null | void> = this.#changes.event;

  constructor(private readonly projects: ProjectRuntimes) {}

  refresh(): void {
    this.#changes.fire();
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
      item.iconPath = new ThemeIcon(node.session.status === 'active' ? 'circle-filled' : node.session.status === 'done' ? 'pass-filled' : 'circle-outline');
      item.contextValue = 'threadport.session';
      item.command = { command: 'threadport.openSession', title: 'Open Session', arguments: [node] };
      return item;
    }
    if (node.kind === 'uninitialized') {
      const item = new TreeItem('Initialize ThreadPort', TreeItemCollapsibleState.None);
      item.description = 'Create local project storage';
      item.iconPath = new ThemeIcon('database');
      item.contextValue = 'threadport.uninitialized';
      item.command = { command: 'threadport.initializeProject', title: 'Initialize Project', arguments: [node] };
      return item;
    }
    const item = new TreeItem(node.label, TreeItemCollapsibleState.None);
    if (node.kind === 'detail') item.description = node.description;
    item.iconPath = new ThemeIcon(node.icon);
    return item;
  }

  getChildren(node?: SessionsNode): SessionsNode[] {
    if (!node) {
      const folders = workspace.workspaceFolders ?? [];
      if (folders.length === 0) return [{ kind: 'message', label: 'Open a project folder to start', icon: 'folder-opened' }];
      return folders.map((folder) => ({ kind: 'project', folder }));
    }
    if (node.kind === 'project') {
      const runtime = this.projects.get(node.folder);
      if (!runtime) return [{ kind: 'uninitialized', folder: node.folder }];
      const sessions = runtime.app.sessions();
      if (sessions.length === 0) return [{ kind: 'message', label: 'No sessions yet', icon: 'info' }];
      return sessions.map((session) => ({ kind: 'session', folder: node.folder, session }));
    }
    if (node.kind === 'session') {
      const runtime = this.projects.get(node.folder);
      if (!runtime) return [];
      const runs = runtime.app.runs(node.session.id);
      const records = runtime.app.records(node.session.id);
      const decisions = runtime.app.decisions(node.session.id);
      const lastRun = runs.at(-1);
      const preferredAgent = records.findLast((record) => record.kind === 'note' && record.title === 'Initial agent')?.body;
      return [
        { kind: 'detail', label: 'Agent', description: lastRun?.agentId ?? preferredAgent ?? 'None', icon: 'hubot' },
        { kind: 'detail', label: 'Relevant files', description: String(records.filter((record) => record.kind === 'file').length), icon: 'files' },
        { kind: 'detail', label: 'Decisions', description: String(decisions.length), icon: 'lightbulb' },
        { kind: 'detail', label: 'Runs', description: String(runs.length), icon: 'history' }
      ];
    }
    return [];
  }
}
