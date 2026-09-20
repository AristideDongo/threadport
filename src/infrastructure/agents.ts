import { spawn, spawnSync } from 'node:child_process';
import type { AgentAdapter, AgentRunner } from '../application/ports.js';

const prompt = (file: string) => `Read the ThreadPort handoff at ${file} and continue the task from the current project state.`;
export const adapters: readonly AgentAdapter[] = [
  { id: 'claude', label: 'Claude Code', command: 'claude', capabilities: ['filesystem_access', 'git_access', 'terminal_access'], args: (file) => [prompt(file)], structuredArgs: (file) => ['-p', '--output-format', 'stream-json', '--verbose', prompt(file)], resumeArgs: (id, file) => ['--resume', id, prompt(file)] },
  { id: 'codex', label: 'Codex CLI', command: 'codex', capabilities: ['filesystem_access', 'git_access', 'terminal_access'], args: (file) => [prompt(file)], structuredArgs: (file) => ['exec', '--json', prompt(file)], resumeArgs: (id, file) => ['resume', '--include-non-interactive', id, prompt(file)] },
];

export function adapterById(id: string, extra: readonly AgentAdapter[] = []): AgentAdapter {
  const adapter = [...adapters, ...extra].find((item) => item.id === id);
  if (!adapter) throw new Error(`Unknown agent: ${id}. Available agents: ${adapters.map((item) => item.id).join(', ')}.`);
  return adapter;
}

export class TerminalAgentRunner implements AgentRunner {
  available(command: string): boolean { return spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], { stdio: 'ignore' }).status === 0; }
  run(command: string, args: string[], cwd: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, stdio: 'inherit', env: process.env });
      child.once('error', reject);
      child.once('close', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1)));
    });
  }
}

export function agentVersion(command: string): string | null {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 3000, windowsHide: true });
  return result.status === 0 ? (result.stdout || result.stderr).trim().split(/\r?\n/, 1)[0]?.slice(0, 120) ?? null : null;
}
