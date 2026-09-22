import { StatusBarAlignment, window, type Disposable, type StatusBarItem } from 'vscode';
import type { ProjectRuntimes } from '../bootstrap/project-runtimes.js';
import { workspaceFolders } from '../vscode-adapters/workspace-projects.js';

export class SessionStatus implements Disposable {
  readonly #item: StatusBarItem = window.createStatusBarItem(StatusBarAlignment.Left, 50);

  constructor(private readonly projects: ProjectRuntimes) {
    this.#item.name = 'ThreadPort session';
    this.#item.command = 'threadport.sessions.focus';
    this.refresh();
    this.#item.show();
  }

  refresh(): void {
    for (const folder of workspaceFolders()) {
      const active = this.projects.peek(folder)?.app.active();
      if (active) {
        this.#item.text = `$(hubot) ThreadPort: ${active.title}`;
        this.#item.tooltip = `${folder.name} · ${active.id}`;
        return;
      }
    }
    this.#item.text = '$(hubot) ThreadPort';
    this.#item.tooltip = 'No active ThreadPort session';
  }

  dispose(): void {
    this.#item.dispose();
  }
}
