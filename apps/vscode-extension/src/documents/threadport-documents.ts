import { createHash, randomUUID } from 'node:crypto';
import {
  CodeLens,
  EventEmitter,
  FileChangeType,
  FileSystemError,
  FileType,
  Range,
  Selection,
  ThemeIcon,
  Uri,
  commands,
  languages,
  window,
  workspace,
  type CodeLensProvider,
  type Disposable,
  type Event,
  type FileChangeEvent,
  type FileStat,
  type FileSystemProvider,
  type TextDocument,
  type WorkspaceFolder
} from 'vscode';
import { readConfig } from '../../../../src/infrastructure/config.js';
import { loadExcludes } from '../../../../src/infrastructure/privacy.js';
import type { AgentController } from '../bootstrap/agent-controller.js';
import type { ProjectRuntimes } from '../bootstrap/project-runtimes.js';
import { parseSessionDocument } from './session-document-model.js';

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

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function folderKey(folder: WorkspaceFolder): string {
  return createHash('sha256').update(folder.uri.toString()).digest('hex').slice(0, 12);
}

export class ThreadPortDocuments implements FileSystemProvider, CodeLensProvider, Disposable {
  readonly #changes = new EventEmitter<FileChangeEvent[]>();
  readonly onDidChangeFile: Event<FileChangeEvent[]> = this.#changes.event;
  readonly #entries = new Map<string, DocumentEntry>();
  readonly #subscriptions: Disposable[];

  constructor(
    private readonly projects: ProjectRuntimes,
    private readonly agents: AgentController,
    private readonly onChange: () => void
  ) {
    this.#subscriptions = [
      workspace.registerFileSystemProvider('threadport', this, { isCaseSensitive: true, isReadonly: false }),
      languages.registerCodeLensProvider({ scheme: 'threadport', language: 'json' }, this),
      commands.registerCommand('threadport.document.switchAgent', (uri: Uri, agentId: string) => this.command(() => this.switchAgent(uri, agentId))),
      commands.registerCommand('threadport.document.previewContext', (uri: Uri) => this.command(() => this.previewContext(uri))),
      commands.registerCommand('threadport.document.activate', (uri: Uri) => this.command(() => this.activateSession(uri)))
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
    this.#changes.fire([{ type: FileChangeType.Deleted, uri: oldUri }, { type: FileChangeType.Created, uri: newUri }]);
  }

  provideCodeLenses(document: TextDocument): CodeLens[] {
    const entry = this.#entries.get(document.uri.toString());
    if (!entry) return [];
    const range = new Range(0, 0, 0, 0);
    if (!entry.sessionId) return [new CodeLens(range, { command: 'workbench.action.files.save', title: '$(add) Create ThreadPort session' })];
    const lenses = [
      new CodeLens(range, { command: 'workbench.action.files.save', title: '$(save) Apply changes' }),
      new CodeLens(range, { command: 'threadport.document.previewContext', title: '$(preview) Preview context', arguments: [document.uri] })
    ];
    if (entry.folder && this.projects.get(entry.folder)?.app.session(entry.sessionId).status !== 'active') {
      lenses.push(new CodeLens(range, { command: 'threadport.document.activate', title: '$(check) Make session active', arguments: [document.uri] }));
    }
    for (const agent of this.agents.options().filter((option) => option.available)) {
      lenses.push(new CodeLens(range, {
        command: 'threadport.document.switchAgent',
        title: `$(debug-start) Switch to ${agent.label}`,
        arguments: [document.uri, agent.id]
      }));
    }
    return lenses;
  }

  async openNewSession(folder?: WorkspaceFolder): Promise<void> {
    const target = folder ?? await this.selectFolder();
    if (!target) return;
    const uri = Uri.from({ scheme: 'threadport', path: `/new/${folderKey(target)}-${randomUUID()}.json`, query: `folder=${encodeURIComponent(target.uri.toString())}` });
    let createdSession: string | null = null;
    this.add(uri, json({
      _instructions: [
        'Edit the objective and optional agent, then save this file.',
        'Supported agents: claude, codex, or null.'
      ],
      project: target.name,
      objective: '',
      agent: null,
      add: { relevantFile: { path: '', reason: '' }, decision: { title: '', rationale: '' } }
    }), async (content) => {
      if (createdSession) return json({ createdSession, message: 'Session already created. Open it from the ThreadPort view.' });
      const edit = parseSessionDocument(content);
      this.assertAgent(edit.agent);
      const runtime = this.projects.get(target, true);
      if (!runtime) throw new Error('Could not initialize this project.');
      const session = runtime.app.newSession(edit.objective);
      if (edit.agent) runtime.app.addRecord('note', 'Initial agent', edit.agent);
      createdSession = session.id;
      this.onChange();
      queueMicrotask(() => { void this.open(target, session.id, 'overview'); });
      return json({ createdSession: session.id, message: 'Session created. The persistent session document has been opened.' });
    }, target, null);
    await this.show(uri);
  }

  async open(folder: WorkspaceFolder, sessionId: string, section: NativeSessionSection = 'overview'): Promise<void> {
    const uri = this.sessionUri(folder, sessionId);
    if (!this.#entries.has(uri.toString())) {
      this.add(uri, this.sessionContent(folder, sessionId), (content) => this.applySession(folder, sessionId, content), folder, sessionId);
    } else {
      this.refreshEntry(uri);
    }
    const editor = await this.show(uri);
    const property = section === 'files' ? '"relevantFiles"' : section === 'decisions' ? '"decisions"' : section === 'runs' ? '"runs"' : section === 'agent' ? '"agent"' : '"objective"';
    const start = editor.document.getText().indexOf(property);
    if (start >= 0) {
      const position = editor.document.positionAt(start);
      editor.selection = new Selection(position, position);
      editor.revealRange(new Range(position, position));
    }
  }

  refresh(): void {
    for (const [key, entry] of this.#entries) {
      if (!entry.folder || !entry.sessionId) continue;
      const document = workspace.textDocuments.find((candidate) => candidate.uri.toString() === key);
      if (document && !document.isDirty) this.setContent(document.uri, this.sessionContent(entry.folder, entry.sessionId));
    }
  }

  dispose(): void {
    for (const subscription of this.#subscriptions) subscription.dispose();
    this.#changes.dispose();
    this.#entries.clear();
  }

  private async applySession(folder: WorkspaceFolder, sessionId: string, content: string): Promise<string> {
    const edit = parseSessionDocument(content);
    this.assertAgent(edit.agent);
    const runtime = this.projects.get(folder);
    if (!runtime) throw new Error('This project is not initialized.');
    const current = runtime.app.session(sessionId);
    const records = runtime.app.records(sessionId);
    const currentAgent = runtime.app.runs(sessionId).at(-1)?.agentId
      ?? records.findLast((record) => record.kind === 'note' && record.title === 'Initial agent')?.body
      ?? null;
    if (edit.objective !== current.title) runtime.app.rename(sessionId, edit.objective);
    if (edit.add.relevantFile.path || edit.add.decision.title) runtime.app.open(sessionId);
    if (edit.add.relevantFile.path) runtime.app.addRecord('file', edit.add.relevantFile.path, edit.add.relevantFile.reason);
    if (edit.add.decision.title) runtime.app.decide(edit.add.decision.title, edit.add.decision.rationale);
    if (edit.agent && edit.agent !== currentAgent) await this.agents.switch(folder, sessionId, edit.agent);
    this.onChange();
    return this.sessionContent(folder, sessionId);
  }

  private sessionContent(folder: WorkspaceFolder, sessionId: string): string {
    const runtime = this.projects.get(folder);
    if (!runtime) throw new Error('This project is not initialized.');
    const session = runtime.app.session(sessionId);
    const records = runtime.app.records(sessionId);
    const runs = runtime.app.runs(sessionId);
    const agent = runs.at(-1)?.agentId
      ?? records.findLast((record) => record.kind === 'note' && record.title === 'Initial agent')?.body
      ?? null;
    return json({
      _instructions: [
        'Edit objective or agent and save to apply changes.',
        'Set agent to claude or codex to switch agents.',
        'Fill one or both objects under add, then save. They reset after being recorded.',
        'History arrays are generated by ThreadPort and refresh after save.'
      ],
      project: folder.name,
      sessionId: session.id,
      objective: session.title,
      status: session.status,
      agent,
      _availableAgents: this.agents.options().map((option) => ({ id: option.id, label: option.label, installed: option.available })),
      add: {
        relevantFile: { path: '', reason: '' },
        decision: { title: '', rationale: '' }
      },
      relevantFiles: records.filter((record) => record.kind === 'file').map((record) => ({ id: record.id, path: record.title, reason: record.body })),
      decisions: runtime.app.decisions(sessionId).map((decision) => ({ title: decision.title, rationale: decision.rationale, createdAt: decision.createdAt })),
      runs: runs.map((run) => ({ id: run.id, agent: run.agentId, status: run.status, startedAt: run.startedAt, endedAt: run.endedAt, exitCode: run.exitCode }))
    });
  }

  private async switchAgent(uri: Uri, agentId: string): Promise<void> {
    const entry = this.entry(uri);
    if (!entry.folder || !entry.sessionId) return;
    await this.agents.switch(entry.folder, entry.sessionId, agentId);
    this.onChange();
    this.refreshEntry(uri);
  }

  private async previewContext(uri: Uri): Promise<void> {
    const entry = this.entry(uri);
    if (!entry.folder || !entry.sessionId) return;
    const runtime = this.projects.get(entry.folder);
    if (!runtime) throw new Error('This project is not initialized.');
    if (runtime.app.session(entry.sessionId).status !== 'active') throw new Error('Make this session active before previewing its context.');
    const content = runtime.app.context(readConfig(entry.folder.uri.fsPath).context.defaultMode, loadExcludes(entry.folder.uri.fsPath));
    const contextUri = Uri.from({ scheme: 'threadport', path: `/context/${folderKey(entry.folder)}-${entry.sessionId}.md`, query: `folder=${encodeURIComponent(entry.folder.uri.toString())}&session=${encodeURIComponent(entry.sessionId)}` });
    this.add(contextUri, content, null, entry.folder, entry.sessionId);
    await this.show(contextUri, true);
    this.onChange();
  }

  private async activateSession(uri: Uri): Promise<void> {
    const entry = this.entry(uri);
    if (!entry.folder || !entry.sessionId) return;
    const runtime = this.projects.get(entry.folder);
    if (!runtime) throw new Error('This project is not initialized.');
    runtime.app.open(entry.sessionId);
    this.onChange();
    this.refreshEntry(uri);
  }

  private async command(work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error: unknown) {
      await window.showErrorMessage(`ThreadPort: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private assertAgent(agent: string | null): void {
    if (agent && !this.agents.options().some((option) => option.id === agent)) throw new Error(`Unknown agent: ${agent}. Use claude, codex, or null.`);
  }

  private async selectFolder(): Promise<WorkspaceFolder | undefined> {
    const folders = workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      await window.showErrorMessage('Open a project folder before using ThreadPort.');
      return undefined;
    }
    if (folders.length === 1) return folders[0];
    const selected = await window.showQuickPick(folders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, folder })), { placeHolder: 'Select a project' });
    return selected?.folder;
  }

  private sessionUri(folder: WorkspaceFolder, sessionId: string): Uri {
    return Uri.from({ scheme: 'threadport', path: `/sessions/${folderKey(folder)}-${sessionId}.json`, query: `folder=${encodeURIComponent(folder.uri.toString())}&session=${encodeURIComponent(sessionId)}` });
  }

  private add(uri: Uri, content: string, write: DocumentEntry['write'], folder: WorkspaceFolder | null, sessionId: string | null): void {
    const now = Date.now();
    this.#entries.set(uri.toString(), { content: encoder.encode(content), createdAt: now, modifiedAt: now, write, folder, sessionId });
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
    if (entry.folder && entry.sessionId) this.setContent(uri, this.sessionContent(entry.folder, entry.sessionId));
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
        this.add(uri, this.sessionContent(folder, sessionId), (content) => this.applySession(folder, sessionId, content), folder, sessionId);
      } catch {
        return;
      }
    }
    if (uri.path.startsWith('/context/') && sessionId) {
      const runtime = this.projects.get(folder);
      if (!runtime) return;
      const session = runtime.app.session(sessionId);
      const content = session.status === 'active'
        ? runtime.app.context(readConfig(folder.uri.fsPath).context.defaultMode, loadExcludes(folder.uri.fsPath))
        : 'Make this session active, then reopen the context preview.\n';
      this.add(uri, content, null, folder, sessionId);
    }
  }

  private async show(uri: Uri, preview = false) {
    const document = await workspace.openTextDocument(uri);
    return window.showTextDocument(document, { preview, preserveFocus: false });
  }
}
