import { spawnSync } from 'node:child_process';
import { window, type Disposable, type Terminal } from 'vscode';
import type { AgentRunner } from '../../../../src/application/ports.js';
import { firstLocatedPath, terminalInvocation } from '../support/agent-command.js';

interface RunningTerminal {
  readonly terminal: Terminal;
  readonly completion: Promise<number>;
  requestStop(): void;
}

function locate(command: string): string | null {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(locator, [command], { encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? firstLocatedPath(result.stdout) : null;
}

export class VSCodeTerminalAgentRunner implements AgentRunner, Disposable {
  readonly #runs = new Map<string, RunningTerminal>();

  available(command: string): boolean {
    return locate(command) !== null;
  }

  run(command: string, args: string[], cwd: string): Promise<number> {
    if (this.#runs.has(cwd)) throw new Error('An agent terminal is already managed for this project.');
    const invocation = terminalInvocation(process.platform, command, locate(command), args, process.env.ComSpec);
    const terminal = window.createTerminal({
      name: `ThreadPort — ${command}`,
      cwd,
      shellPath: invocation.shellPath,
      shellArgs: invocation.shellArgs,
      isTransient: false,
    });
    let stopped = false;
    let requestStop = (): void => {
      stopped = true;
      terminal.dispose();
    };
    const completion = new Promise<number>((resolve) => {
      const subscription = window.onDidCloseTerminal((closed) => {
        if (closed !== terminal) return;
        subscription.dispose();
        this.#runs.delete(cwd);
        requestStop = () => undefined;
        resolve(stopped ? 130 : (closed.exitStatus?.code ?? 1));
      });
    });
    this.#runs.set(cwd, { terminal, completion, requestStop: () => requestStop() });
    terminal.show(false);
    return completion;
  }

  owns(cwd: string): boolean {
    return this.#runs.has(cwd);
  }

  sendText(cwd: string, value: string): void {
    const run = this.#runs.get(cwd);
    if (!run) throw new Error('No ThreadPort agent terminal is running for this project.');
    run.terminal.sendText(value, true);
    run.terminal.show(false);
  }

  async stop(cwd: string): Promise<void> {
    const run = this.#runs.get(cwd);
    if (!run) return;
    run.requestStop();
    await run.completion;
  }

  dispose(): void {
    for (const run of this.#runs.values()) run.requestStop();
    this.#runs.clear();
  }
}
