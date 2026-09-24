import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { relative, sep } from 'node:path';
import {
  CodeLens,
  Diagnostic,
  DiagnosticSeverity,
  EventEmitter,
  FileChangeType,
  FileSystemError,
  FileType,
  Position,
  Range,
  Selection,
  Uri,
  commands,
  extensions,
  l10n,
  languages,
  window,
  workspace,
  type CodeLensProvider,
  type DiagnosticCollection,
  type Disposable,
  type Event,
  type FileChangeEvent,
  type Memento,
  type FileStat,
  type FileSystemProvider,
  type TextDocument,
  type TextEditor,
  type WorkspaceFolder,
} from 'vscode';
import { verificationCommands } from '../../../../src/infrastructure/config.js';
import { LocalCommandExecutor } from '../../../../src/infrastructure/command-executor.js';
import { assertWorkspaceTrusted, type AgentController } from '../bootstrap/agent-controller.js';
import { report } from '../logging.js';
import type { ProjectRuntimes } from '../bootstrap/project-runtimes.js';
import { headingOffset, parseSessionDocument } from './session-document-model.js';

export type NativeSessionSection = 'overview' | 'agent' | 'files' | 'decisions' | 'runs';

interface DocumentEntry {
  content: Uint8Array;
  readonly createdAt: number;
  modifiedAt: number;
  readonly write: ((content: string) => Promise<string>) | null;
  readonly folder: WorkspaceFolder | null;
  readonly sessionId: string | null;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function folderKey(folder: WorkspaceFolder): string {
  return createHash('sha256').update(folder.uri.toString()).digest('hex').slice(0, 12);
}

function markdownText(value: string): string {
  return value.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function line(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export class ThreadPortDocuments implements FileSystemProvider, CodeLensProvider, Disposable {
  readonly #changes = new EventEmitter<FileChangeEvent[]>();
  readonly onDidChangeFile: Event<FileChangeEvent[]> = this.#changes.event;
  readonly #entries = new Map<string, DocumentEntry>();
  readonly #diagnostics: DiagnosticCollection;
  readonly #subscriptions: Disposable[];

  constructor(
    private readonly projects: ProjectRuntimes,
    private readonly agents: AgentController,
    private readonly onChange: () => void,
    /** Workspace state, so an unsent "Next instruction" survives a window reload. */
    private readonly drafts: Memento,
  ) {
    this.#diagnostics = languages.createDiagnosticCollection('threadport');
    this.#subscriptions = [
      workspace.registerFileSystemProvider('threadport', this, { isCaseSensitive: true, isReadonly: false }),
      languages.registerCodeLensProvider({ scheme: 'threadport', language: 'markdown' }, this),
      workspace.onDidChangeTextDocument(({ document }) => this.validate(document)),
      workspace.onDidCloseTextDocument((document) => this.forget(document.uri)),
      commands.registerCommand('threadport.document.runInstruction', (uri?: Uri) =>
        this.command(() => this.runInstruction(this.targetDocumentUri(uri))),
      ),
      commands.registerCommand('threadport.document.stopAgent', (uri?: Uri) =>
        this.command(() => this.stopAgent(this.targetDocumentUri(uri))),
      ),
      commands.registerCommand('threadport.document.resume', (uri?: Uri) =>
        this.command(() => this.resumeInterrupted(this.targetDocumentUri(uri))),
      ),
      commands.registerCommand('threadport.document.switchAgent', (uri: Uri, agentId: string) =>
        this.command(() => this.switchAgent(uri, agentId)),
      ),
      commands.registerCommand('threadport.document.previewContext', (uri?: Uri) =>
        this.command(() => this.previewContext(this.targetDocumentUri(uri))),
      ),
      commands.registerCommand('threadport.document.verify', (uri?: Uri) =>
        this.command(() => this.verify(this.targetDocumentUri(uri))),
      ),
      commands.registerCommand('threadport.document.reviewChanges', (uri?: Uri) =>
        this.command(() => this.reviewChanges(this.targetDocumentUri(uri))),
      ),
      commands.registerCommand('threadport.document.activate', (uri?: Uri) =>
        this.command(() => this.activateSession(this.targetDocumentUri(uri))),
      ),
      commands.registerCommand('threadport.addActiveFile', (uri?: Uri) =>
        this.command(() => this.addEditorContext(false, uri)),
      ),
      commands.registerCommand('threadport.addSelectionToContext', () =>
        this.command(() => this.addEditorContext(true)),
      ),
    ];
  }

  watch(): Disposable {
    return { dispose: () => undefined };
  }

  stat(uri: Uri): FileStat {
    const entry = this.entry(uri);
    return { type: FileType.File, ctime: entry.createdAt, mtime: entry.modifiedAt, size: entry.content.byteLength };
  }

  readDirectory(): [string, FileType][] {
    return [];
  }
  createDirectory(): void {}
  readFile(uri: Uri): Uint8Array {
    return this.entry(uri).content;
  }

  async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
    const entry = this.entry(uri);
    if (!entry.write) throw FileSystemError.NoPermissions('This ThreadPort document is read-only.');
    const canonical = await entry.write(decoder.decode(content));
    this.setContent(uri, canonical);
  }

  delete(uri: Uri): void {
    this.#entries.delete(uri.toString());
    this.#changes.fire([{ type: FileChangeType.Deleted, uri }]);
  }

  rename(oldUri: Uri, newUri: Uri): void {
    const entry = this.entry(oldUri);
    this.#entries.delete(oldUri.toString());
    this.#entries.set(newUri.toString(), entry);
    this.#changes.fire([
      { type: FileChangeType.Deleted, uri: oldUri },
      { type: FileChangeType.Created, uri: newUri },
    ]);
  }

  provideCodeLenses(document: TextDocument): CodeLens[] {
    const entry = this.#entries.get(document.uri.toString());
    if (!entry || (!document.uri.path.startsWith('/sessions/') && !document.uri.path.startsWith('/new/'))) return [];
    const at = (heading: string): Range => {
      const position = document.positionAt(headingOffset(document.getText(), heading));
      return new Range(position, position);
    };
    if (!entry.sessionId) {
      return [
        new CodeLens(at('Objective'), {
          command: 'workbench.action.files.save',
          title: `$(add) ${l10n.t('Create ThreadPort session')}`,
        }),
      ];
    }
    const lenses = [
      new CodeLens(at('Objective'), {
        command: 'workbench.action.files.save',
        title: `$(save) ${l10n.t('Apply changes')}`,
      }),
      new CodeLens(at('Next instruction'), {
        command: 'threadport.document.runInstruction',
        title: `$(play) ${l10n.t('Run instruction')}`,
        arguments: [document.uri],
      }),
      new CodeLens(at('Next instruction'), {
        command: 'threadport.document.previewContext',
        title: `$(preview) ${l10n.t('Preview context')}`,
        arguments: [document.uri],
      }),
      new CodeLens(at('Verification'), {
        command: 'threadport.document.verify',
        title: `$(beaker) ${l10n.t('Verify work')}`,
        arguments: [document.uri],
      }),
      new CodeLens(at('Changes'), {
        command: 'threadport.document.reviewChanges',
        title: `$(diff) ${l10n.t('Review changes')}`,
        arguments: [document.uri],
      }),
    ];
    if (entry.folder && this.agents.isRunning(entry.folder)) {
      lenses.push(
        new CodeLens(at('Agent'), {
          command: 'threadport.document.stopAgent',
          title: `$(debug-stop) ${l10n.t('Stop current agent')}`,
          arguments: [document.uri],
        }),
      );
    }
    if (entry.folder) {
      const lastRun = this.projects.get(entry.folder)?.app.runs(entry.sessionId).at(-1);
      if (lastRun?.status === 'interrupted') {
        lenses.push(
          new CodeLens(at('Runs'), {
            command: 'threadport.document.resume',
            title: `$(debug-rerun) Resume with ${lastRun.agentId}`,
            arguments: [document.uri],
          }),
        );
      }
    }
    if (entry.folder && this.projects.get(entry.folder)?.app.session(entry.sessionId).status !== 'active') {
      lenses.push(
        new CodeLens(at('Objective'), {
          command: 'threadport.document.activate',
          title: `$(check) ${l10n.t('Make session active')}`,
          arguments: [document.uri],
        }),
      );
    }
    for (const agent of this.agents.options(entry.folder ?? undefined).filter((option) => option.available)) {
      lenses.push(
        new CodeLens(at('Agent'), {
          command: 'threadport.document.switchAgent',
          title: `$(arrow-swap) Switch to ${agent.label}`,
          arguments: [document.uri, agent.id],
        }),
      );
    }
    return lenses;
  }

  async openNewSession(folder?: WorkspaceFolder): Promise<void> {
    const target = folder ?? (await this.selectFolder());
    if (!target) return;
    const uri = Uri.from({
      scheme: 'threadport',
      path: `/new/${folderKey(target)}-${randomUUID()}.md`,
      query: `folder=${encodeURIComponent(target.uri.toString())}`,
    });
    let createdSession: string | null = null;
    this.add(
      uri,
      this.newSessionContent(target),
      async (content) => {
        if (createdSession)
          return `# Session created\n\nOpen session \`${createdSession}\` from the ThreadPort view.\n`;
        const edit = parseSessionDocument(content);
        this.assertAgent(edit.agent, target);
        const runtime = this.projects.get(target, true);
        if (!runtime) throw new Error(l10n.t('Could not initialize this project.'));
        const session = runtime.app.newSession(edit.objective);
        if (edit.agent) runtime.app.addRecord('note', 'Initial agent', edit.agent);
        if (edit.nextInstruction) await this.setDraft(target, session.id, edit.nextInstruction);
        createdSession = session.id;
        this.onChange();
        queueMicrotask(() => {
          void this.open(target, session.id, 'overview');
        });
        return `# Session created\n\nThreadPort session \`${session.id}\` has been created.\n`;
      },
      target,
      null,
    );
    await this.show(uri);
  }

  async open(folder: WorkspaceFolder, sessionId: string, section: NativeSessionSection = 'overview'): Promise<void> {
    const uri = this.sessionUri(folder, sessionId);
    if (!this.#entries.has(uri.toString())) {
      this.add(
        uri,
        this.sessionContent(folder, sessionId),
        (content) => this.applySession(folder, sessionId, content),
        folder,
        sessionId,
      );
    } else {
      this.refreshEntry(uri);
    }
    const editor = await this.show(uri);
    const heading =
      section === 'files'
        ? 'Relevant files'
        : section === 'decisions'
          ? 'Decisions'
          : section === 'runs'
            ? 'Runs'
            : section === 'agent'
              ? 'Agent'
              : 'Objective';
    const position = editor.document.positionAt(headingOffset(editor.document.getText(), heading));
    editor.selection = new Selection(position, position);
    editor.revealRange(new Range(position, position));
  }

  /**
   * Opens a sourced handoff draft for review. Saving the document stores it as the session handoff,
   * the same as `threadport handoff save`.
   */
  async openHandoff(folder: WorkspaceFolder): Promise<void> {
    const runtime = this.projects.get(folder);
    const session = runtime?.app.active();
    if (!runtime || !session) throw new Error(l10n.t('Open an active ThreadPort session for this project first.'));
    const uri = Uri.from({ scheme: 'threadport', path: `/handoff/${folderKey(folder)}-${session.id}.md` });
    const saved = runtime.app.latestHandoff();
    this.add(
      uri,
      saved && !saved.stale ? saved.content : runtime.app.handoffDraft(),
      async (content) => {
        runtime.app.saveHandoff(content);
        this.onChange();
        void window.showInformationMessage(l10n.t('Handoff saved for session {0}.', session.id));
        return content;
      },
      folder,
      session.id,
    );
    await this.show(uri);
  }

  refresh(): void {
    for (const [key, entry] of this.#entries) {
      const uri = Uri.parse(key);
      if (!entry.folder || !entry.sessionId || !uri.path.startsWith('/sessions/')) continue;
      const document = workspace.textDocuments.find((candidate) => candidate.uri.toString() === key);
      if (document && !document.isDirty)
        this.setContent(document.uri, this.sessionContent(entry.folder, entry.sessionId));
    }
  }

  dispose(): void {
    for (const subscription of this.#subscriptions) subscription.dispose();
    this.#diagnostics.dispose();
    this.#changes.dispose();
    this.#entries.clear();
  }

  private newSessionContent(folder: WorkspaceFolder): string {
    return `# New ThreadPort session

Edit the fields below and save the document. Use \`none\`, \`claude\`, or \`codex\` as the agent.

## Objective


## Agent
none

## Next instruction


## Add relevant file
Path:
Reason:

## Record decision
Title:
Rationale:

<!-- threadport:generated -->
## Project
${markdownText(folder.name)}
`;
  }

  private async applySession(folder: WorkspaceFolder, sessionId: string, content: string): Promise<string> {
    const edit = parseSessionDocument(content);
    this.assertAgent(edit.agent, folder);
    const runtime = this.projects.get(folder);
    if (!runtime) throw new Error(l10n.t('This project is not initialized.'));
    const current = runtime.app.session(sessionId);
    if (edit.objective !== current.title) runtime.app.rename(sessionId, edit.objective);
    if (edit.add.relevantFile.path || edit.add.decision.title) runtime.app.open(sessionId);
    if (edit.add.relevantFile.path)
      runtime.app.addRecord('file', edit.add.relevantFile.path, edit.add.relevantFile.reason);
    if (edit.add.decision.title) runtime.app.decide(edit.add.decision.title, edit.add.decision.rationale);
    await this.setDraft(folder, sessionId, edit.nextInstruction);
    const preferred = runtime.app
      .records(sessionId)
      .findLast(
        (record) => record.kind === 'note' && (record.title === 'Preferred agent' || record.title === 'Initial agent'),
      )?.body;
    if (edit.agent && edit.agent !== preferred) runtime.app.addRecord('note', 'Preferred agent', edit.agent);
    this.onChange();
    return this.sessionContent(folder, sessionId);
  }

  private sessionContent(folder: WorkspaceFolder, sessionId: string): string {
    const runtime = this.projects.get(folder);
    if (!runtime) throw new Error(l10n.t('This project is not initialized.'));
    const session = runtime.app.session(sessionId);
    const records = runtime.app.records(sessionId);
    const runs = runtime.app.runs(sessionId);
    const agent =
      runs.at(-1)?.agentId ??
      records.findLast(
        (record) => record.kind === 'note' && (record.title === 'Preferred agent' || record.title === 'Initial agent'),
      )?.body ??
      'none';
    const files = records.filter((record) => record.kind === 'file');
    const decisions = runtime.app.decisions(sessionId);
    const events = runtime.app.events(sessionId).slice(-12).reverse();
    const git = this.projects.git.read(folder.uri.fsPath);
    const verification = session.status === 'active' ? runtime.app.verificationStatus() : null;
    const running = runs.findLast((run) => run.status === 'running');
    const installed = this.agents
      .options(folder)
      .map((option) => `${option.available ? '✓' : '○'} ${option.label}`)
      .join(' · ');
    return `# ${markdownText(session.title)}

ThreadPort session \`${session.id}\` · project **${markdownText(folder.name)}**

## Objective
${session.title}

## Agent
${markdownText(agent)}

## Next instruction
${this.drafts.get<string>(this.draftKey(folder, sessionId)) ?? ''}

## Add relevant file
Path:
Reason:

## Record decision
Title:
Rationale:

<!-- threadport:generated -->
## Session status
${session.status}${running ? ` · ${running.agentId} is running since ${running.startedAt}` : ''}

Installed agents: ${installed}

Write the next task under **Next instruction**, then use the CodeLens action **Run instruction**.

## Changes
${git?.warning ? `⚠ ${markdownText(git.warning)}\n\n` : ''}${git?.changedFiles.length ? git.changedFiles.map((path) => `- \`${markdownText(path)}\``).join('\n') : 'No Git changes detected.'}

## Verification
${verification ? `${verification.current ? '✓' : '○'} ${verification.report.passed ? 'Passed' : 'Failed'} · ${verification.report.results.length} command(s)` : 'No current verification report.'}

## Relevant files
${files.length ? files.map((file) => `- \`${markdownText(file.title)}\`${file.body ? ` — ${markdownText(line(file.body))}` : ''}`).join('\n') : 'No relevant files recorded.'}

## Decisions
${decisions.length ? decisions.map((decision) => `- **${markdownText(decision.title)}**${decision.rationale ? ` — ${markdownText(line(decision.rationale))}` : ''}`).join('\n') : 'No decisions recorded.'}

## Runs
${
  runs.length
    ? runs
        .slice()
        .reverse()
        .map(
          (run) =>
            `- \`${run.agentId}\` · ${run.status} · ${run.startedAt}${run.exitCode === null ? '' : ` · exit ${run.exitCode}`}`,
        )
        .join('\n')
    : 'No agent runs recorded.'
}

## Timeline
${events.length ? events.map((event) => `- ${event.createdAt} · **${event.type}** · ${markdownText(line(event.message))}`).join('\n') : 'No events recorded.'}
`;
  }

  private async runInstruction(uri: Uri): Promise<void> {
    // Checked first so nothing is recorded for an instruction that cannot run.
    assertWorkspaceTrusted();
    const entry = this.entry(uri);
    if (!entry.folder || !entry.sessionId) return;
    const document = this.openDocument(uri);
    const edit = parseSessionDocument(document.getText());
    if (!edit.nextInstruction) throw new Error(l10n.t('Write an instruction in the Next instruction section first.'));
    if (!(await document.save())) throw new Error(l10n.t('Save the session document before running the instruction.'));
    const runtime = this.projects.get(entry.folder);
    if (!runtime) throw new Error(l10n.t('This project is not initialized.'));
    const running = runtime.app
      .sessions()
      .flatMap((session) => runtime.app.runs(session.id))
      .findLast((run) => run.status === 'running');
    if (this.agents.isRunning(entry.folder) && running?.sessionId !== entry.sessionId) {
      throw new Error(
        l10n.t('Another ThreadPort session owns the running agent. Stop it before continuing this session.'),
      );
    }
    runtime.app.open(entry.sessionId);
    const taskTitle = line(edit.nextInstruction).slice(0, 200);
    runtime.app.addRecord('task', taskTitle, edit.nextInstruction === taskTitle ? '' : edit.nextInstruction, 'open');
    await this.setDraft(entry.folder, entry.sessionId, '');
    if (this.agents.isRunning(entry.folder)) {
      this.agents.sendInstruction(entry.folder, edit.nextInstruction);
      this.refreshEntry(uri);
      return;
    }
    const agentId = edit.agent ?? (await this.selectAgent(entry.folder));
    if (!agentId) return;
    this.refreshEntry(uri);
    await this.agents.switch(entry.folder, entry.sessionId, agentId);
  }

  private async stopAgent(uri: Uri): Promise<void> {
    const entry = this.entry(uri);
    if (!entry.folder) return;
    await this.agents.stop(entry.folder);
    this.refreshEntry(uri);
  }

  private async resumeInterrupted(uri: Uri): Promise<void> {
    // Checked first so nothing is recorded for an instruction that cannot run.
    assertWorkspaceTrusted();
    const entry = this.entry(uri);
    if (!entry.folder || !entry.sessionId) return;
    const runtime = this.projects.get(entry.folder);
    if (!runtime) throw new Error(l10n.t('This project is not initialized.'));
    const lastRun = runtime.app.runs(entry.sessionId).at(-1);
    if (lastRun?.status !== 'interrupted')
      throw new Error(l10n.t('This session has no interrupted agent run to resume.'));
    await this.agents.switch(entry.folder, entry.sessionId, lastRun.agentId, lastRun.providerSessionId ?? null);
    this.refreshEntry(uri);
  }

  private async switchAgent(uri: Uri, agentId: string): Promise<void> {
    const entry = this.entry(uri);
    if (!entry.folder || !entry.sessionId) return;
    await this.agents.switch(entry.folder, entry.sessionId, agentId);
    this.onChange();
    this.refreshEntry(uri);
  }

  private async verify(uri: Uri): Promise<void> {
    const entry = this.entry(uri);
    if (!entry.folder || !entry.sessionId) return;
    const runtime = this.projects.get(entry.folder);
    if (!runtime) throw new Error(l10n.t('This project is not initialized.'));
    assertWorkspaceTrusted();
    runtime.app.open(entry.sessionId);
    const checks = verificationCommands(entry.folder.uri.fsPath);
    if (!checks.length)
      throw new Error(
        l10n.t('No verification commands were detected. Configure verification.commands in .threadport/config.json.'),
      );
    const report = await window.withProgress(
      { location: { viewId: 'threadport.sessions' }, title: l10n.t('ThreadPort: verifying work') },
      () => runtime.app.verify(checks, new LocalCommandExecutor()),
    );
    this.onChange();
    this.refreshEntry(uri);
    await window.showInformationMessage(
      report.passed
        ? l10n.t('ThreadPort verification passed.')
        : l10n.t('ThreadPort verification failed. Review the session document for details.'),
    );
  }

  private async reviewChanges(uri: Uri): Promise<void> {
    const entry = this.entry(uri);
    if (!entry.folder) return;
    const cwd = entry.folder.uri.fsPath;
    const state = this.projects.git.read(cwd);
    if (!state?.changedFiles.length) {
      await window.showInformationMessage(l10n.t('ThreadPort: no Git changes to review.'));
      return;
    }
    const selected = await window.showQuickPick(
      state.changedFiles.map((path) => ({ label: path })),
      { placeHolder: l10n.t('Select a changed file to review') },
    );
    if (!selected) return;
    const currentUri = Uri.joinPath(entry.folder.uri, ...selected.label.split('/'));
    // The built-in Git extension handles large, renamed and deleted files; the fallback below does not need it.
    if (extensions.getExtension('vscode.git')?.isActive) {
      try {
        await commands.executeCommand('git.openChange', currentUri);
        return;
      } catch (error: unknown) {
        report(error, 'git.openChange');
      }
    }
    let current = currentUri;
    try {
      await workspace.fs.stat(currentUri);
    } catch {
      current = Uri.from({
        scheme: 'threadport',
        path: `/review/current-${createHash('sha256').update(selected.label).digest('hex')}.txt`,
      });
      this.add(current, '', null, entry.folder, entry.sessionId);
    }
    let baseline = '';
    try {
      baseline = execFileSync('git', ['show', `HEAD:${selected.label}`], {
        cwd,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      /* New file: compare against an empty baseline. */
    }
    const baseUri = Uri.from({
      scheme: 'threadport',
      path: `/review/base-${createHash('sha256').update(selected.label).digest('hex')}-${encodeURIComponent(selected.label)}`,
    });
    this.add(baseUri, baseline, null, entry.folder, entry.sessionId);
    await commands.executeCommand('vscode.diff', baseUri, current, `${selected.label} (HEAD ↔ working tree)`);
  }

  private async previewContext(uri: Uri): Promise<void> {
    const entry = this.entry(uri);
    if (!entry.folder || !entry.sessionId) return;
    const runtime = this.projects.get(entry.folder);
    if (!runtime) throw new Error(l10n.t('This project is not initialized.'));
    if (runtime.app.session(entry.sessionId).status !== 'active')
      throw new Error(l10n.t('Make this session active before previewing its context.'));
    const content = this.projects.context(entry.folder);
    const contextUri = Uri.from({
      scheme: 'threadport',
      path: `/context/${folderKey(entry.folder)}-${entry.sessionId}.md`,
      query: `folder=${encodeURIComponent(entry.folder.uri.toString())}&session=${encodeURIComponent(entry.sessionId)}`,
    });
    this.add(contextUri, content, null, entry.folder, entry.sessionId);
    await this.show(contextUri, true);
    this.onChange();
  }

  private async activateSession(uri: Uri): Promise<void> {
    const entry = this.entry(uri);
    if (!entry.folder || !entry.sessionId) return;
    const runtime = this.projects.get(entry.folder);
    if (!runtime) throw new Error(l10n.t('This project is not initialized.'));
    runtime.app.open(entry.sessionId);
    this.onChange();
    this.refreshEntry(uri);
  }

  private async addEditorContext(selectionOnly: boolean, resource?: Uri): Promise<void> {
    const editor = window.activeTextEditor;
    const target = selectionOnly ? editor?.document.uri : resource?.scheme === 'file' ? resource : editor?.document.uri;
    if (target?.scheme !== 'file') throw new Error(l10n.t('Open or select a workspace file first.'));
    const folder = workspace.getWorkspaceFolder(target);
    if (!folder) throw new Error(l10n.t('The active file is outside the current workspace.'));
    const runtime = this.projects.get(folder);
    if (!runtime?.app.active()) throw new Error(l10n.t('Open an active ThreadPort session for this project first.'));
    const path = relative(folder.uri.fsPath, target.fsPath).split(sep).join('/');
    let reason = 'Added explicitly from the VS Code editor.';
    if (selectionOnly) {
      if (!editor || editor.document.uri.toString() !== target.toString())
        throw new Error(l10n.t('Open a file and select code first.'));
      if (editor.selection.isEmpty) throw new Error(l10n.t('Select code before adding a selection to context.'));
      const first = editor.selection.start.line + 1;
      const last = editor.selection.end.line + 1;
      reason = `Selected lines ${first}-${last}:\n${editor.document.getText(editor.selection).slice(0, 18_000)}`;
    }
    runtime.app.addRecord('file', path, reason);
    this.onChange();
    await window.showInformationMessage(l10n.t('Added {0} to the active ThreadPort context.', path));
  }

  private validate(document: TextDocument): void {
    if (
      document.uri.scheme !== 'threadport' ||
      !document.uri.path.endsWith('.md') ||
      (!document.uri.path.startsWith('/sessions/') && !document.uri.path.startsWith('/new/'))
    )
      return;
    try {
      parseSessionDocument(document.getText());
      this.#diagnostics.delete(document.uri);
    } catch (error: unknown) {
      const diagnostic = new Diagnostic(
        new Range(new Position(0, 0), new Position(0, Math.max(1, document.lineAt(0).text.length))),
        error instanceof Error ? error.message : String(error),
        DiagnosticSeverity.Error,
      );
      diagnostic.source = 'ThreadPort';
      this.#diagnostics.set(document.uri, [diagnostic]);
    }
  }

  private async command(work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error: unknown) {
      await window.showErrorMessage(`ThreadPort: ${report(error, 'Command')}`);
    }
  }

  private async setDraft(folder: WorkspaceFolder, sessionId: string, value: string): Promise<void> {
    await this.drafts.update(this.draftKey(folder, sessionId), value || undefined);
  }

  /** Drops closed virtual documents; sessions and context previews rebuild on demand through `hydrate`. */
  private forget(uri: Uri): void {
    this.#diagnostics.delete(uri);
    if (uri.scheme !== 'threadport') return;
    this.#entries.delete(uri.toString());
  }

  private assertAgent(agent: string | null, folder: WorkspaceFolder): void {
    const options = this.agents.options(folder);
    if (agent && !options.some((option) => option.id === agent))
      throw new Error(
        l10n.t('Unknown agent: {0}. Use {1}, or none.', agent, options.map((option) => option.id).join(', ')),
      );
  }

  private async selectAgent(folder: WorkspaceFolder): Promise<string | undefined> {
    const pick = await window.showQuickPick(
      this.agents
        .options(folder)
        .filter((agent) => agent.available)
        .map((agent) => ({ label: agent.label, description: agent.command, id: agent.id })),
      { placeHolder: l10n.t('Select an installed agent') },
    );
    return pick?.id;
  }

  private async selectFolder(): Promise<WorkspaceFolder | undefined> {
    const folders = workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      await window.showErrorMessage(l10n.t('Open a project folder before using ThreadPort.'));
      return undefined;
    }
    if (folders.length === 1) return folders[0];
    const selected = await window.showQuickPick(
      folders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, folder })),
      { placeHolder: l10n.t('Select a project') },
    );
    return selected?.folder;
  }

  private sessionUri(folder: WorkspaceFolder, sessionId: string): Uri {
    return Uri.from({
      scheme: 'threadport',
      path: `/sessions/${folderKey(folder)}-${sessionId}.md`,
      query: `folder=${encodeURIComponent(folder.uri.toString())}&session=${encodeURIComponent(sessionId)}`,
    });
  }

  private draftKey(folder: WorkspaceFolder, sessionId: string): string {
    return `${folder.uri.toString()}::${sessionId}`;
  }

  private add(
    uri: Uri,
    content: string,
    write: DocumentEntry['write'],
    folder: WorkspaceFolder | null,
    sessionId: string | null,
  ): void {
    const now = Date.now();
    this.#entries.set(uri.toString(), {
      content: encoder.encode(content),
      createdAt: now,
      modifiedAt: now,
      write,
      folder,
      sessionId,
    });
    this.#changes.fire([{ type: FileChangeType.Created, uri }]);
  }

  private setContent(uri: Uri, content: string): void {
    const entry = this.entry(uri);
    entry.content = encoder.encode(content);
    entry.modifiedAt = Date.now();
    this.#changes.fire([{ type: FileChangeType.Changed, uri }]);
  }

  private refreshEntry(uri: Uri): void {
    const entry = this.entry(uri);
    if (entry.folder && entry.sessionId && uri.path.startsWith('/sessions/'))
      this.setContent(uri, this.sessionContent(entry.folder, entry.sessionId));
  }

  private entry(uri: Uri): DocumentEntry {
    let entry = this.#entries.get(uri.toString());
    if (!entry) {
      this.hydrate(uri);
      entry = this.#entries.get(uri.toString());
    }
    if (!entry) throw FileSystemError.FileNotFound(uri);
    return entry;
  }

  private hydrate(uri: Uri): void {
    const parameters = new URLSearchParams(uri.query);
    const folderUri = parameters.get('folder');
    const folder = (workspace.workspaceFolders ?? []).find((candidate) => candidate.uri.toString() === folderUri);
    if (!folder) return;
    const sessionId = parameters.get('session');
    if (uri.path.startsWith('/sessions/') && sessionId) {
      const runtime = this.projects.get(folder);
      if (!runtime) return;
      try {
        runtime.app.session(sessionId);
        this.add(
          uri,
          this.sessionContent(folder, sessionId),
          (content) => this.applySession(folder, sessionId, content),
          folder,
          sessionId,
        );
      } catch {
        return;
      }
    }
    if (uri.path.startsWith('/context/') && sessionId) {
      const runtime = this.projects.get(folder);
      if (!runtime) return;
      const session = runtime.app.session(sessionId);
      const content =
        session.status === 'active'
          ? this.projects.context(folder)
          : 'Make this session active, then reopen the context preview.\n';
      this.add(uri, content, null, folder, sessionId);
    }
  }

  private openDocument(uri: Uri): TextDocument {
    const document = workspace.textDocuments.find((candidate) => candidate.uri.toString() === uri.toString());
    if (!document) throw new Error(l10n.t('The session document is not open.'));
    return document;
  }

  private targetDocumentUri(uri?: Uri): Uri {
    const target = uri ?? window.activeTextEditor?.document.uri;
    if (target?.scheme !== 'threadport' || !target.path.startsWith('/sessions/'))
      throw new Error(l10n.t('Open a ThreadPort session document first.'));
    return target;
  }

  private async show(uri: Uri, preview = false): Promise<TextEditor> {
    const document = await workspace.openTextDocument(uri);
    return window.showTextDocument(document, { preview, preserveFocus: false });
  }
}
