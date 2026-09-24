import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { l10n, window, workspace, type WorkspaceFolder } from 'vscode';
import type { AgentAdapter } from '../../../../src/application/ports.js';
import { assertTrusted, loadAgentPlugins } from '../../../../src/infrastructure/agent-plugins.js';
import { adapterById, adapters } from '../../../../src/infrastructure/agents.js';
import { log, report } from '../logging.js';
import type { VSCodeTerminalAgentRunner } from '../vscode-adapters/terminal-agent-runner.js';
import type { ProjectRuntimes } from './project-runtimes.js';

export interface AgentOption {
  readonly id: string;
  readonly label: string;
  readonly command: string;
  readonly available: boolean;
  /** False for a project manifest the user has not trusted with `threadport plugin trust`. */
  readonly trusted: boolean;
}

/** Agents, commands and verification execute project-controlled code, so they need a trusted workspace. */
export function assertWorkspaceTrusted(): void {
  if (!workspace.isTrusted)
    throw new Error(l10n.t('Trust this workspace before running agents or verification commands.'));
}

export class AgentController {
  /** `which`/`where` is a blocking process spawn; CodeLens asks for availability on nearly every keystroke. */
  readonly #available = new Map<string, boolean>();

  constructor(
    private readonly projects: ProjectRuntimes,
    private readonly runner: VSCodeTerminalAgentRunner,
    private readonly onChange: () => void,
  ) {}

  /** Forgets cached availability, e.g. after the user installs an agent CLI and refreshes. */
  invalidate(): void {
    this.#available.clear();
  }

  options(folder?: WorkspaceFolder): readonly AgentOption[] {
    return this.agents(folder).map((adapter) => {
      const trusted = !('trusted' in adapter) || adapter.trusted === true;
      return {
        id: adapter.id,
        label: adapter.label,
        command: adapter.command,
        // Never probe an untrusted manifest's command.
        available: trusted && this.available(adapter.command),
        trusted,
      };
    });
  }

  isRunning(folder: WorkspaceFolder): boolean {
    return this.runner.owns(folder.uri.fsPath);
  }

  async stop(folder: WorkspaceFolder): Promise<void> {
    if (!this.runner.owns(folder.uri.fsPath))
      throw new Error(l10n.t('No ThreadPort agent is running for this project.'));
    await this.runner.stop(folder.uri.fsPath);
    this.onChange();
  }

  sendInstruction(folder: WorkspaceFolder, instruction: string): void {
    assertWorkspaceTrusted();
    this.runner.sendText(folder.uri.fsPath, instruction);
    this.onChange();
  }

  async switch(
    folder: WorkspaceFolder,
    sessionId: string,
    agentId: string,
    providerSessionId: string | null = null,
  ): Promise<void> {
    assertWorkspaceTrusted();
    const runtime = this.projects.get(folder);
    if (!runtime) throw new Error(l10n.t('This project is not initialized.'));
    const adapter = adapterById(agentId, this.plugins(folder));
    assertTrusted(adapter);
    if (!this.available(adapter.command))
      throw new Error(l10n.t('{0} was not found ({1}).', adapter.label, adapter.command));

    const cwd = folder.uri.fsPath;
    const running = runtime.app
      .sessions()
      .flatMap((session) => runtime.app.runs(session.id))
      .findLast((run) => run.status === 'running');
    if (running) {
      if (!this.runner.owns(cwd))
        throw new Error(
          l10n.t('The current agent run was started outside this VS Code window. Stop it before switching.'),
        );
      await this.runner.stop(cwd);
    }
    runtime.app.open(sessionId);

    const directory = mkdtempSync(join(tmpdir(), 'threadport-vscode-'));
    const contextFile = join(directory, 'handoff.md');
    writeFileSync(contextFile, this.projects.context(folder), { mode: 0o600 });

    log().info(`${folder.name}: launching ${adapter.id} for session ${sessionId}`);
    const completion = runtime.app.run(adapter, this.runner, contextFile, providerSessionId);
    this.onChange();
    void window.showInformationMessage(
      l10n.t('Launching {0} with the {1} context.', adapter.label, runtime.app.session(sessionId).title),
    );
    void completion
      .then((run) => {
        log().info(`${folder.name}: ${adapter.id} run ${run.id} ${run.status} (exit ${run.exitCode})`);
        this.onChange();
        void window.showInformationMessage(l10n.t('{0} run {1}.', adapter.label, run.status));
      })
      .catch((error: unknown) => {
        void window.showErrorMessage(`ThreadPort: ${report(error, `${adapter.id} run`)}`);
      })
      .finally(() => {
        rmSync(directory, { recursive: true, force: true });
        this.onChange();
      });
  }

  private plugins(folder: WorkspaceFolder) {
    try {
      return loadAgentPlugins(this.projects.projectDir(folder));
    } catch (error: unknown) {
      report(error, `${folder.name}: loading agent manifests`);
      return [];
    }
  }

  private agents(folder?: WorkspaceFolder): readonly AgentAdapter[] {
    return folder ? [...adapters, ...this.plugins(folder)] : adapters;
  }

  private available(command: string): boolean {
    let value = this.#available.get(command);
    if (value === undefined) {
      value = this.runner.available(command);
      this.#available.set(command, value);
    }
    return value;
  }
}
