import { spawn, spawnSync } from 'node:child_process';
import type { AgentRunner } from '../application/ports.js';

export interface CapturedAgentEvent { kind: 'session' | 'command' | 'message' | 'error' | 'usage'; title: string; body: string; exitCode?: number; }
function object(value: unknown): Record<string, unknown> | null { return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null; }
function string(value: unknown): string { return typeof value === 'string' ? value : ''; }
export function interpretAgentEvent(agentId: string, value: unknown): CapturedAgentEvent | null {
  const event = object(value);
  if (!event) return null;
  const type = string(event.type);
  if (agentId === 'codex') {
    if (type === 'thread.started') return { kind: 'session', title: 'Codex thread', body: string(event.thread_id) };
    if (type === 'error' || type === 'turn.failed') return { kind: 'error', title: 'Codex error', body: JSON.stringify(event).slice(0, 20000) };
    if (type === 'turn.completed') return { kind: 'usage', title: 'Codex usage', body: JSON.stringify(event.usage ?? {}).slice(0, 2000) };
    if (type !== 'item.completed') return null;
    const item = object(event.item);
    if (!item) return null;
    if (item.type === 'command_execution') return { kind: 'command', title: string(item.command).slice(0, 200), body: string(item.aggregated_output).slice(0, 20000), ...(typeof item.exit_code === 'number' ? { exitCode: item.exit_code } : {}) };
    if (item.type === 'agent_message') return { kind: 'message', title: 'Codex output', body: string(item.text).slice(0, 20000) };
  }
  if (agentId === 'claude') {
    if (type === 'system' && event.subtype === 'init') return { kind: 'session', title: 'Claude session', body: string(event.session_id) };
    if (type === 'assistant') {
      const message = object(event.message);
      const content = Array.isArray(message?.content) ? message.content : [];
      const tool = content.map(object).find((item) => item?.type === 'tool_use' && item.name === 'Bash');
      if (tool) return { kind: 'command', title: string(object(tool.input)?.command).slice(0, 200), body: '' };
    }
    if (type === 'result') return { kind: event.is_error === true ? 'error' : 'message', title: 'Claude result', body: string(event.result).slice(0, 20000) };
  }
  return null;
}
export class StructuredAgentRunner implements AgentRunner {
  constructor(private readonly onEvent: (event: CapturedAgentEvent) => void) {}
  available(command: string): boolean { return spawnSync('which', [command], { stdio: 'ignore' }).status === 0; }
  run(command: string, args: string[], cwd: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'inherit'] });
      let pending = '';
      const consume = (line: string): void => {
        if (!line.trim()) return;
        try {
          const value: unknown = JSON.parse(line);
          const event = interpretAgentEvent(command, value);
          if (event) this.onEvent(event);
        } catch { process.stdout.write(line + '\n'); }
      };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        pending += chunk;
        while (pending.includes('\n')) {
          const index = pending.indexOf('\n');
          const line = pending.slice(0, index); pending = pending.slice(index + 1);
          consume(line);
        }
      });
      child.once('error', reject);
      child.once('close', (code) => { consume(pending); resolve(code ?? 1); });
    });
  }
}
