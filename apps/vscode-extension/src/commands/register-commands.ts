import { commands, l10n, window, type Disposable, type QuickPickItem, type WorkspaceFolder } from 'vscode';
import type { Session } from '../../../../src/domain/model.js';
import type { ProjectRuntimes } from '../bootstrap/project-runtimes.js';
import type { ThreadPortDocuments } from '../documents/threadport-documents.js';
import { report } from '../logging.js';
import { currentFolder } from '../status-bar/session-status.js';
import type { DetailNode, ProjectNode, SessionNode, UninitializedNode } from '../views/sessions-tree.js';
import { selectWorkspaceFolder, workspaceFolders } from '../vscode-adapters/workspace-projects.js';

interface SessionPick extends QuickPickItem {
  readonly folder: WorkspaceFolder;
  readonly session: Session;
}

type ProjectArgument = ProjectNode | UninitializedNode;

async function safely(work: () => Promise<void> | void): Promise<void> {
  try {
    await work();
  } catch (error: unknown) {
    await window.showErrorMessage(`ThreadPort: ${report(error, 'Command')}`);
  }
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
  const pick = await window.showQuickPick(picks, { placeHolder: l10n.t('Select a ThreadPort session') });
  return pick ? { kind: 'session', folder: pick.folder, session: pick.session } : undefined;
}

/** The folder holding the active session: the active editor's folder when it has one. */
async function activeProject(projects: ProjectRuntimes): Promise<WorkspaceFolder | undefined> {
  const preferred = currentFolder(projects);
  if (preferred && projects.get(preferred)?.app.active()) return preferred;
  return selectWorkspaceFolder(l10n.t('Select a project'));
}

export function registerCommands(
  projects: ProjectRuntimes,
  documents: ThreadPortDocuments,
  refresh: () => void,
): readonly Disposable[] {
  const runtimeFor = (folder: WorkspaceFolder) => {
    const runtime = projects.get(folder);
    if (!runtime) throw new Error(l10n.t('This project is not initialized.'));
    return runtime;
  };
  const sessionCommand = (id: string, work: (node: SessionNode) => Promise<void> | void) =>
    commands.registerCommand(id, (node?: SessionNode) =>
      safely(async () => {
        const selected = node ?? (await selectSession(projects));
        if (selected) await work(selected);
      }),
    );

  return [
    commands.registerCommand('threadport.initializeProject', (argument?: ProjectArgument) =>
      safely(async () => {
        const folder = argument?.folder ?? (await selectWorkspaceFolder(l10n.t('Select a project to initialize')));
        if (!folder) return;
        const alreadyInitialized = projects.isInitialized(folder);
        projects.get(folder, true);
        refresh();
        await window.showInformationMessage(
          alreadyInitialized
            ? l10n.t('{0} is already initialized.', folder.name)
            : l10n.t('ThreadPort initialized for {0}.', folder.name),
        );
      }),
    ),

    commands.registerCommand('threadport.newSession', () => safely(() => documents.openNewSession())),

    commands.registerCommand('threadport.openSessionPage', (node?: SessionNode | DetailNode) =>
      safely(async () => {
        const selected = node ?? (await selectSession(projects));
        if (!selected) return;
        await documents.open(
          selected.folder,
          selected.session.id,
          selected.kind === 'detail' ? selected.section : 'overview',
        );
      }),
    ),

    sessionCommand('threadport.openSession', async (node) => {
      runtimeFor(node.folder).app.open(node.session.id);
      refresh();
      await documents.open(node.folder, node.session.id, 'overview');
    }),

    sessionCommand('threadport.renameSession', async (node) => {
      const title = await window.showInputBox({
        prompt: l10n.t('New session title'),
        value: node.session.title,
        validateInput: (value) =>
          value.trim() && value.trim().length <= 200 ? null : l10n.t('Use between 1 and 200 characters.'),
      });
      if (!title) return;
      runtimeFor(node.folder).app.rename(node.session.id, title);
      refresh();
    }),

    sessionCommand('threadport.finishSession', (node) => {
      runtimeFor(node.folder).app.finish(node.session.id);
      refresh();
    }),

    sessionCommand('threadport.deleteSession', async (node) => {
      const confirm = l10n.t('Delete');
      const answer = await window.showWarningMessage(
        l10n.t('Permanently delete the session "{0}" and its history?', node.session.title),
        { modal: true },
        confirm,
      );
      if (answer !== confirm) return;
      runtimeFor(node.folder).app.deleteSession(node.session.id);
      refresh();
    }),

    commands.registerCommand('threadport.search', () =>
      safely(async () => {
        const query = await window.showInputBox({ prompt: l10n.t('Search sessions, decisions, and records') });
        if (!query?.trim()) return;
        const picks = workspaceFolders().flatMap((folder) => {
          const runtime = projects.get(folder);
          return (runtime?.app.search(query) ?? []).map((hit) => ({
            label: hit.title,
            description: `${folder.name} · ${hit.source} · ${hit.sessionId}`,
            detail: hit.snippet,
            folder,
            sessionId: hit.sessionId,
          }));
        });
        if (!picks.length) {
          await window.showInformationMessage(l10n.t('No results for "{0}".', query));
          return;
        }
        const pick = await window.showQuickPick(picks, { matchOnDescription: true, matchOnDetail: true });
        if (pick) await documents.open(pick.folder, pick.sessionId, 'overview');
      }),
    ),

    commands.registerCommand('threadport.draftHandoff', () =>
      safely(async () => {
        const folder = await activeProject(projects);
        if (folder) await documents.openHandoff(folder);
      }),
    ),

    commands.registerCommand('threadport.linkWork', () =>
      safely(async () => {
        const folder = await activeProject(projects);
        if (!folder) return;
        const url = await window.showInputBox({
          prompt: l10n.t('GitHub issue or pull request URL'),
          placeHolder: 'https://github.com/owner/repo/pull/42',
        });
        if (!url) return;
        const kind = /\/pull\/\d+/.test(url) ? 'pr' : 'issue';
        const record = runtimeFor(folder).app.linkWork(kind, url.trim());
        refresh();
        await window.showInformationMessage(l10n.t('Linked {0}.', record.title));
      }),
    ),

    commands.registerCommand('threadport.privacyAudit', () =>
      safely(async () => {
        const folder = await activeProject(projects);
        if (!folder) return;
        const audit = runtimeFor(folder).app.privacyAudit(projects.contextMode(folder));
        await window.showInformationMessage(
          l10n.t(
            'Redaction candidates: {0} · Excluded references: {1} · Context tokens: {2}',
            audit.redactedFields,
            audit.excludedReferences,
            audit.contextTokens,
          ),
          { modal: true, detail: audit.warnings.join('\n') },
        );
      }),
    ),

    commands.registerCommand('threadport.showMenu', () =>
      safely(async () => {
        const actions = [
          { label: `$(add) ${l10n.t('New Session')}`, command: 'threadport.newSession' },
          { label: `$(list-selection) ${l10n.t('Open Session')}`, command: 'threadport.openSession' },
          { label: `$(search) ${l10n.t('Search')}`, command: 'threadport.search' },
          { label: `$(note) ${l10n.t('Draft Handoff')}`, command: 'threadport.draftHandoff' },
          { label: `$(link) ${l10n.t('Link Issue or Pull Request')}`, command: 'threadport.linkWork' },
          { label: `$(shield) ${l10n.t('Privacy Audit')}`, command: 'threadport.privacyAudit' },
          { label: `$(output) ${l10n.t('Show Logs')}`, command: 'threadport.showLogs' },
        ];
        const pick = await window.showQuickPick(actions, { placeHolder: 'ThreadPort' });
        if (pick) await commands.executeCommand(pick.command);
      }),
    ),

    commands.registerCommand('threadport.refresh', refresh),
  ];
}
