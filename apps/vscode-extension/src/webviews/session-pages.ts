import { randomBytes } from 'node:crypto';
import {
  ViewColumn,
  window,
  workspace,
  type Disposable,
  type Webview,
  type WebviewPanel,
  type WorkspaceFolder
} from 'vscode';
import type { Session } from '../../../../src/domain/model.js';
import { readConfig } from '../../../../src/infrastructure/config.js';
import { loadExcludes } from '../../../../src/infrastructure/privacy.js';
import type { AgentController } from '../bootstrap/agent-controller.js';
import type { ProjectRuntimes } from '../bootstrap/project-runtimes.js';
import { escapeHtml as h, parseSessionPageMessage, type SessionSection } from './session-page-model.js';

interface OpenSessionPage {
  readonly panel: WebviewPanel;
  readonly folder: WorkspaceFolder;
  readonly sessionId: string;
  section: SessionSection;
}

const labels: Record<SessionSection, string> = {
  overview: 'Overview',
  agent: 'Agent',
  files: 'Relevant files',
  decisions: 'Decisions',
  runs: 'Runs'
};

function nonce(): string {
  return randomBytes(16).toString('base64url');
}

function pageShell(webview: Webview, title: string, body: string, script: string): string {
  const token = nonce();
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${token}';">
<title>${h(title)}</title><style>
  :root { color-scheme: light dark; }
  body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); font: var(--vscode-font-size)/1.55 var(--vscode-font-family); }
  main { max-width: 960px; margin: 0 auto; padding: 32px 28px 64px; }
  h1 { margin: 0 0 6px; font-size: 26px; } h2 { margin-top: 28px; font-size: 18px; } h3 { margin: 0 0 6px; font-size: 14px; }
  .muted { color: var(--vscode-descriptionForeground); } .header { display:flex; justify-content:space-between; gap:24px; align-items:flex-start; }
  .badge { display:inline-block; border:1px solid var(--vscode-panel-border); border-radius:999px; padding:3px 9px; text-transform:capitalize; }
  nav { display:flex; flex-wrap:wrap; gap:4px; margin:28px 0 22px; border-bottom:1px solid var(--vscode-panel-border); }
  nav button { background:transparent; border:0; border-bottom:2px solid transparent; color:var(--vscode-foreground); padding:9px 12px; cursor:pointer; }
  nav button.active { border-bottom-color:var(--vscode-focusBorder); color:var(--vscode-textLink-foreground); }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:12px; }
  .card, form, .empty { border:1px solid var(--vscode-panel-border); border-radius:7px; padding:16px; background:var(--vscode-sideBar-background); }
  .card strong.metric { display:block; font-size:24px; margin-top:4px; }
  .list { display:grid; gap:10px; padding:0; list-style:none; } .list .card { background:transparent; }
  form { display:grid; gap:12px; margin-bottom:20px; } label { display:grid; gap:5px; font-weight:600; }
  input, textarea, select { box-sizing:border-box; width:100%; color:var(--vscode-input-foreground); background:var(--vscode-input-background); border:1px solid var(--vscode-input-border); padding:8px 10px; font:inherit; }
  textarea { min-height:90px; resize:vertical; } input:focus, textarea:focus, select:focus { outline:1px solid var(--vscode-focusBorder); }
  button.primary, button.secondary { width:max-content; border:1px solid transparent; border-radius:2px; padding:7px 13px; cursor:pointer; font:inherit; }
  button.primary { color:var(--vscode-button-foreground); background:var(--vscode-button-background); } button.primary:hover { background:var(--vscode-button-hoverBackground); }
  button.secondary { color:var(--vscode-button-secondaryForeground); background:var(--vscode-button-secondaryBackground); }
  button:disabled { opacity:.55; cursor:not-allowed; } .actions { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  table { width:100%; border-collapse:collapse; } th, td { text-align:left; padding:9px 8px; border-bottom:1px solid var(--vscode-panel-border); vertical-align:top; }
  code { color:var(--vscode-textPreformat-foreground); } .error { border-left:3px solid var(--vscode-errorForeground); padding:10px 12px; margin-bottom:18px; background:var(--vscode-inputValidation-errorBackground); }
  details { margin-top:20px; } summary { cursor:pointer; color:var(--vscode-textLink-foreground); } pre { max-height:420px; overflow:auto; white-space:pre-wrap; border:1px solid var(--vscode-panel-border); padding:14px; background:var(--vscode-textCodeBlock-background); }
  @media (max-width:600px) { main { padding:22px 16px 48px; } .header { display:block; } table { display:block; overflow:auto; } }
</style></head><body><main>${body}</main><script nonce="${token}">${script}</script></body></html>`;
}

export class SessionPages implements Disposable {
  readonly #sessions = new Map<string, OpenSessionPage>();
  #newSession: WebviewPanel | null = null;

  constructor(
    private readonly projects: ProjectRuntimes,
    private readonly agents: AgentController,
    private readonly onChange: () => void
  ) {}

  openNewSession(): void {
    if (this.#newSession) {
      this.#newSession.reveal(ViewColumn.Active);
      this.renderNewSession();
      return;
    }
    const panel = window.createWebviewPanel('threadport.newSession', 'ThreadPort — New Session', ViewColumn.Active, { enableScripts: true });
    this.#newSession = panel;
    panel.onDidDispose(() => { this.#newSession = null; });
    panel.webview.onDidReceiveMessage((raw: unknown) => this.handleNewSessionMessage(raw));
    this.renderNewSession();
  }

  open(folder: WorkspaceFolder, sessionId: string, section: SessionSection = 'overview'): void {
    const key = `${folder.uri.toString()}::${sessionId}`;
    const existing = this.#sessions.get(key);
    if (existing) {
      existing.section = section;
      existing.panel.reveal(ViewColumn.Active);
      this.renderSession(existing);
      return;
    }
    const runtime = this.projects.get(folder);
    if (!runtime) throw new Error('This project is not initialized.');
    const session = runtime.app.session(sessionId);
    const panel = window.createWebviewPanel('threadport.session', `ThreadPort — ${session.title}`, ViewColumn.Active, { enableScripts: true });
    const page: OpenSessionPage = { panel, folder, sessionId, section };
    this.#sessions.set(key, page);
    panel.onDidDispose(() => this.#sessions.delete(key));
    panel.webview.onDidReceiveMessage((raw: unknown) => this.handleSessionMessage(page, raw));
    this.renderSession(page);
  }

  refresh(): void {
    if (this.#newSession) this.renderNewSession();
    for (const page of this.#sessions.values()) this.renderSession(page);
  }

  dispose(): void {
    this.#newSession?.dispose();
    for (const page of this.#sessions.values()) page.panel.dispose();
    this.#sessions.clear();
  }

  private async handleNewSessionMessage(raw: unknown): Promise<void> {
    const message = parseSessionPageMessage(raw);
    if (message?.type !== 'createSession') return;
    try {
      const folder = (workspace.workspaceFolders ?? []).find((candidate) => candidate.uri.toString() === message.projectUri);
      if (!folder) throw new Error('Select an open project.');
      const runtime = this.projects.get(folder, true);
      if (!runtime) throw new Error('Could not initialize this project.');
      if (message.agentId && !this.agents.options().some((agent) => agent.id === message.agentId)) throw new Error(`Unknown agent: ${message.agentId}.`);
      const session = runtime.app.newSession(message.objective);
      if (message.agentId) runtime.app.addRecord('note', 'Initial agent', message.agentId);
      this.onChange();
      this.#newSession?.dispose();
      this.open(folder, session.id, 'overview');
    } catch (error: unknown) {
      await window.showErrorMessage(`ThreadPort: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleSessionMessage(page: OpenSessionPage, raw: unknown): Promise<void> {
    const message = parseSessionPageMessage(raw);
    if (!message) return;
    try {
      const runtime = this.projects.get(page.folder);
      if (!runtime) throw new Error('This project is not initialized.');
      if (message.type === 'navigate') page.section = message.section;
      if (message.type === 'activateSession') runtime.app.open(page.sessionId);
      if (message.type === 'addFile') {
        runtime.app.open(page.sessionId);
        runtime.app.addRecord('file', message.path, message.reason);
      }
      if (message.type === 'addDecision') {
        runtime.app.open(page.sessionId);
        runtime.app.decide(message.title, message.rationale);
      }
      if (message.type === 'switchAgent') await this.agents.switch(page.folder, page.sessionId, message.agentId);
      this.onChange();
      this.renderSession(page);
    } catch (error: unknown) {
      await window.showErrorMessage(`ThreadPort: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private renderNewSession(): void {
    const panel = this.#newSession;
    if (!panel) return;
    const folders = workspace.workspaceFolders ?? [];
    const options = folders.map((folder) => `<option value="${h(folder.uri.toString())}">${h(folder.name)} — ${h(folder.uri.fsPath)}</option>`).join('');
    const agents = this.agents.options().map((agent) => `<option value="${h(agent.id)}">${h(agent.label)}${agent.available ? '' : ' (not installed)'}</option>`).join('');
    const body = `<div class="header"><div><h1>New development session</h1><p class="muted">Create one project-owned context that can continue across AI agents.</p></div></div>
      ${folders.length === 0 ? '<div class="empty">Open a project folder before creating a session.</div>' : `<form id="new-session">
        <label>Project<select id="project" required>${options}</select></label>
        <label>Objective<textarea id="objective" maxlength="200" required placeholder="Implement refresh-token rotation"></textarea></label>
        <label>Initial agent<select id="agent"><option value="">None — choose later</option>${agents}</select></label>
        <div class="actions"><button class="primary" type="submit">Create session</button></div>
      </form>`}`;
    const script = `const vscode=acquireVsCodeApi();document.querySelector('#new-session')?.addEventListener('submit',(event)=>{event.preventDefault();vscode.postMessage({type:'createSession',projectUri:document.querySelector('#project').value,objective:document.querySelector('#objective').value,agentId:document.querySelector('#agent').value||null});});`;
    panel.webview.html = pageShell(panel.webview, 'New ThreadPort Session', body, script);
  }

  private renderSession(page: OpenSessionPage): void {
    const runtime = this.projects.get(page.folder);
    if (!runtime) return;
    const session = runtime.app.session(page.sessionId);
    page.panel.title = `ThreadPort — ${session.title}`;
    const records = runtime.app.records(session.id);
    const files = records.filter((record) => record.kind === 'file');
    const decisions = runtime.app.decisions(session.id);
    const runs = runtime.app.runs(session.id);
    const events = runtime.app.events(session.id);
    const lastRun = runs.at(-1);
    const preferredAgent = records.findLast((record) => record.kind === 'note' && record.title === 'Initial agent')?.body ?? null;
    const navigation = (Object.keys(labels) as SessionSection[]).map((section) => `<button data-section="${section}" class="${section === page.section ? 'active' : ''}">${labels[section]}</button>`).join('');
    const header = `<div class="header"><div><h1>${h(session.title)}</h1><div class="muted">${h(page.folder.name)} · ${h(session.id)}</div></div><span class="badge">${h(session.status)}</span></div><nav>${navigation}</nav>`;
    const contextPreview = page.section === 'agent' && session.status === 'active'
      ? runtime.app.context(readConfig(page.folder.uri.fsPath).context.defaultMode, loadExcludes(page.folder.uri.fsPath))
      : null;
    const content = this.section(page.section, session, { files, decisions, runs, events, currentAgent: lastRun?.agentId ?? preferredAgent, contextPreview });
    const script = `const vscode=acquireVsCodeApi();
      document.querySelectorAll('[data-section]').forEach((button)=>button.addEventListener('click',()=>vscode.postMessage({type:'navigate',section:button.dataset.section})));
      document.querySelector('[data-activate]')?.addEventListener('click',()=>vscode.postMessage({type:'activateSession'}));
      document.querySelectorAll('[data-agent]').forEach((button)=>button.addEventListener('click',()=>vscode.postMessage({type:'switchAgent',agentId:button.dataset.agent})));
      document.querySelector('#add-file')?.addEventListener('submit',(event)=>{event.preventDefault();vscode.postMessage({type:'addFile',path:document.querySelector('#file-path').value,reason:document.querySelector('#file-reason').value});});
      document.querySelector('#add-decision')?.addEventListener('submit',(event)=>{event.preventDefault();vscode.postMessage({type:'addDecision',title:document.querySelector('#decision-title').value,rationale:document.querySelector('#decision-rationale').value});});`;
    page.panel.webview.html = pageShell(page.panel.webview, session.title, header + content, script);
  }

  private section(section: SessionSection, session: Session, data: {
    readonly files: ReturnType<NonNullable<ReturnType<ProjectRuntimes['get']>>['app']['records']>;
    readonly decisions: ReturnType<NonNullable<ReturnType<ProjectRuntimes['get']>>['app']['decisions']>;
    readonly runs: ReturnType<NonNullable<ReturnType<ProjectRuntimes['get']>>['app']['runs']>;
    readonly events: ReturnType<NonNullable<ReturnType<ProjectRuntimes['get']>>['app']['events']>;
    readonly currentAgent: string | null;
    readonly contextPreview: string | null;
  }): string {
    if (section === 'overview') {
      const recent = data.events.slice(-8).reverse().map((event) => `<li class="card"><h3>${h(event.type)}</h3><div>${h(event.message)}</div><small class="muted">${h(new Date(event.createdAt).toLocaleString())}</small></li>`).join('');
      return `<div class="grid">
        <div class="card"><span class="muted">Agent</span><strong class="metric">${h(data.currentAgent ?? 'None')}</strong></div>
        <div class="card"><span class="muted">Relevant files</span><strong class="metric">${data.files.length}</strong></div>
        <div class="card"><span class="muted">Decisions</span><strong class="metric">${data.decisions.length}</strong></div>
        <div class="card"><span class="muted">Runs</span><strong class="metric">${data.runs.length}</strong></div>
      </div><h2>Session actions</h2><div class="actions">${session.status === 'active' ? '<span class="muted">This session is active.</span>' : '<button class="primary" data-activate>Make active</button>'}</div>
      <h2>Recent activity</h2>${recent ? `<ul class="list">${recent}</ul>` : '<div class="empty">No activity has been recorded yet.</div>'}`;
    }
    if (section === 'agent') {
      const options = this.agents.options().map((agent) => `<div class="card"><h3>${h(agent.label)}</h3><div class="muted"><code>${h(agent.command)}</code> · ${agent.available ? 'Available' : 'Not installed'}</div><div class="actions" style="margin-top:12px"><button class="${agent.id === data.currentAgent ? 'secondary' : 'primary'}" data-agent="${h(agent.id)}" ${agent.available ? '' : 'disabled'}>${agent.id === data.currentAgent ? 'Restart with this agent' : `Switch to ${h(agent.label)}`}</button></div></div>`).join('');
      return `<h2>Current agent</h2><div class="card"><strong class="metric">${h(data.currentAgent ?? 'None selected')}</strong><p class="muted">Switching creates a fresh context pack and starts the selected agent in a VS Code terminal.</p></div><h2>Available agents</h2><div class="grid">${options}</div><details><summary>Preview the context sent to the next agent</summary><pre>${h(data.contextPreview ?? 'Make this session active to preview its context.')}</pre></details>`;
    }
    if (section === 'files') {
      const items = data.files.map((file) => `<li class="card"><h3><code>${h(file.title)}</code></h3>${file.body ? `<div>${h(file.body)}</div>` : '<div class="muted">No reason recorded.</div>'}</li>`).join('');
      return `<h2>Add a relevant file</h2><form id="add-file"><label>Project-relative path<input id="file-path" required maxlength="200" placeholder="src/auth/auth.service.ts"></label><label>Why it matters<textarea id="file-reason" maxlength="20000"></textarea></label><button class="primary" type="submit">Add file</button></form><h2>Relevant files</h2>${items ? `<ul class="list">${items}</ul>` : '<div class="empty">No relevant files have been recorded.</div>'}`;
    }
    if (section === 'decisions') {
      const items = data.decisions.slice().reverse().map((decision) => `<li class="card"><h3>${h(decision.title)}</h3>${decision.rationale ? `<div>${h(decision.rationale)}</div>` : '<div class="muted">No rationale recorded.</div>'}<small class="muted">${h(new Date(decision.createdAt).toLocaleString())}</small></li>`).join('');
      return `<h2>Record a decision</h2><form id="add-decision"><label>Decision<input id="decision-title" required maxlength="200" placeholder="Use Redis for token identifiers"></label><label>Rationale<textarea id="decision-rationale" maxlength="20000"></textarea></label><button class="primary" type="submit">Record decision</button></form><h2>Decisions</h2>${items ? `<ul class="list">${items}</ul>` : '<div class="empty">No decisions have been recorded.</div>'}`;
    }
    const rows = data.runs.slice().reverse().map((run) => `<tr><td><code>${h(run.id)}</code></td><td>${h(run.agentId)}</td><td>${h(run.status)}</td><td>${h(new Date(run.startedAt).toLocaleString())}</td><td>${run.exitCode ?? '—'}</td></tr>`).join('');
    return `<h2>Agent runs</h2>${rows ? `<table><thead><tr><th>ID</th><th>Agent</th><th>Status</th><th>Started</th><th>Exit</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty">No agent runs have been recorded.</div>'}`;
  }
}
