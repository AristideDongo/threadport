import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { window, type WorkspaceFolder } from 'vscode';
import { readConfig } from '../../../../src/infrastructure/config.js';
import { adapterById, adapters } from '../../../../src/infrastructure/agents.js';
import { loadExcludes } from '../../../../src/infrastructure/privacy.js';
import type { ProjectRuntimes } from './project-runtimes.js';
import type { VSCodeTerminalAgentRunner } from '../vscode-adapters/terminal-agent-runner.js';

export interface AgentOption {
  readonly id: string;
  readonly label: string;
  readonly command: string;
  readonly available: boolean;
}

export class AgentController {
  constructor(
    private readonly projects: ProjectRuntimes,
    private readonly runner: VSCodeTerminalAgentRunner,
    private readonly onChange: () => void,
  ) {}

  options(): readonly AgentOption[] {
    return adapters.map((adapter) => ({
      id: adapter.id,
      label: adapter.label,
      command: adapter.command,
      available: this.runner.available(adapter.command),
    }));
  }

  isRunning(folder: WorkspaceFolder): boolean {
    return this.runner.owns(folder.uri.fsPath);
  }

  async stop(folder: WorkspaceFolder): Promise<void> {
    if (!this.runner.owns(folder.uri.fsPath)) throw new Error('No ThreadPort agent is running for this project.');
    await this.runner.stop(folder.uri.fsPath);
    this.onChange();
  }

  sendInstruction(folder: WorkspaceFolder, instruction: string): void {
    this.runner.sendText(folder.uri.fsPath, instruction);
    this.onChange();
  }

  async switch(
    folder: WorkspaceFolder,
    sessionId: string,
    agentId: string,
    providerSessionId: string | null = null,
  ): Promise<void> {
    const runtime = this.projects.get(folder);
    if (!runtime) throw new Error('This project is not initialized.');
    const adapter = adapterById(agentId);
    if (!this.runner.available(adapter.command))
      throw new Error(`${adapter.label} was not found (${adapter.command}).`);

    const cwd = folder.uri.fsPath;
    const running = runtime.app
      .sessions()
      .flatMap((session) => runtime.app.runs(session.id))
      .findLast((run) => run.status === 'running');
    if (running) {
      if (!this.runner.owns(cwd))
        throw new Error('The current agent run was started outside this VS Code window. Stop it before switching.');
      await this.runner.stop(cwd);
    }
    runtime.app.open(sessionId);

    const directory = mkdtempSync(join(tmpdir(), 'threadport-vscode-'));
    const contextFile = join(directory, 'handoff.md');
    writeFileSync(contextFile, runtime.app.context(readConfig(cwd).context.defaultMode, loadExcludes(cwd)), {
      mode: 0o600,
    });

    const completion = runtime.app.run(adapter, this.runner, contextFile, providerSessionId);
    this.onChange();
    void window.showInformationMessage(
      `Launching ${adapter.label} with the ${runtime.app.session(sessionId).title} context.`,
    );
    void completion
      .then((run) => {
        this.onChange();
        void window.showInformationMessage(`${adapter.label} run ${run.status}.`);
      })
      .catch((error: unknown) => {
        void window.showErrorMessage(`ThreadPort: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        rmSync(directory, { recursive: true, force: true });
        this.onChange();
      });
  }
}
