import { spawn, spawnSync } from 'node:child_process';
import type { AgentAdapter, AgentRunner } from '../application/ports.js';

export const adapters: readonly AgentAdapter[] = [
  { id: 'claude', label: 'Claude Code', command: 'claude', capabilities: ['filesystem_access', 'git_access', 'terminal_access'], args: (file) => [`Read the ThreadPort handoff at ${file} and continue the task from the current project state.`] },
  { id: 'codex', label: 'Codex CLI', command: 'codex', capabilities: ['filesystem_access', 'git_access', 'terminal_access'], args: (file) => [`Read the ThreadPort handoff at ${file} and continue the task from the current project state.`] },
];

export function adapterById(id: string): AgentAdapter {
  const adapter = adapters.find((item) => item.id === id);
  if (!adapter) throw new Error(`Agent inconnu : ${id}. Agents disponibles : ${adapters.map((item) => item.id).join(', ')}.`);
  return adapter;
}

export class TerminalAgentRunner implements AgentRunner {
  available(command: string): boolean { return spawnSync('which', [command], { stdio: 'ignore' }).status === 0; }
  run(command: string, args: string[], cwd: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, stdio: 'inherit', env: process.env });
      child.once('error', reject);
      child.once('close', (code, signal) => resolve(code ?? (signal ? 128 : 1)));
    });
  }
}
