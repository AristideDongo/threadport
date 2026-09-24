import { spawn, spawnSync } from 'node:child_process';
import type { AgentRunner } from '../application/ports.js';

export interface CapturedAgentEvent {
  kind: 'session' | 'command' | 'message' | 'error' | 'usage';
  title: string;
  body: string;
  exitCode?: number;
}
function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}
function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
export function interpretAgentEvents(agentId: string, value: unknown): CapturedAgentEvent[] {
  const event = object(value);
  if (!event) return [];
  const type = string(event.type);
  if (agentId === 'codex') {
    if (type === 'thread.started') return [{ kind: 'session', title: 'Codex thread', body: string(event.thread_id) }];
    if (type === 'error' || type === 'turn.failed')
      return [{ kind: 'error', title: 'Codex error', body: JSON.stringify(event).slice(0, 20000) }];
    if (type === 'turn.completed')
      return [{ kind: 'usage', title: 'Codex usage', body: JSON.stringify(event.usage ?? {}).slice(0, 2000) }];
    if (type !== 'item.completed') return [];
    const item = object(event.item);
    if (!item) return [];
    if (item.type === 'command_execution')
      return [
        {
          kind: 'command',
          title: string(item.command).slice(0, 200),
          body: string(item.aggregated_output).slice(0, 20000),
          ...(typeof item.exit_code === 'number' ? { exitCode: item.exit_code } : {}),
        },
      ];
    if (item.type === 'agent_message')
      return [{ kind: 'message', title: 'Codex output', body: string(item.text).slice(0, 20000) }];
    if (item.type === 'file_change')
      return [
        { kind: 'message', title: 'Codex file changes', body: JSON.stringify(item.changes ?? []).slice(0, 20000) },
      ];
  }
  if (agentId === 'claude') {
    if (type === 'system' && event.subtype === 'init')
      return [{ kind: 'session', title: 'Claude session', body: string(event.session_id) }];
    if (type === 'assistant') {
      const message = object(event.message);
      const content = Array.isArray(message?.content) ? message.content : [];
      return content.flatMap((block: unknown): CapturedAgentEvent[] => {
        const item = object(block);
        if (item?.type === 'text' && string(item.text))
          return [{ kind: 'message', title: 'Claude output', body: string(item.text).slice(0, 20000) }];
        if (item?.type === 'tool_use' && item.name === 'Bash')
          return [{ kind: 'command', title: string(object(item.input)?.command).slice(0, 200), body: '' }];
        return [];
      });
    }
    if (type === 'result') {
      const result: CapturedAgentEvent[] = [
        {
          kind: event.is_error === true ? 'error' : 'message',
          title: 'Claude result',
          body: string(event.result).slice(0, 20000),
        },
      ];
      if (object(event.usage))
        result.push({ kind: 'usage', title: 'Claude usage', body: JSON.stringify(event.usage).slice(0, 2000) });
      return result;
    }
  }
  return [];
}
export function interpretAgentEvent(agentId: string, value: unknown): CapturedAgentEvent | null {
  return interpretAgentEvents(agentId, value)[0] ?? null;
}
export class StructuredAgentRunner implements AgentRunner {
  constructor(
    private readonly agentId: string,
    private readonly onEvent: (event: CapturedAgentEvent) => void,
  ) {}
  available(command: string): boolean {
    return spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], { stdio: 'ignore' }).status === 0;
  }
  run(command: string, args: string[], cwd: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'inherit'] });
      let pending = '';
      let failed = false;
      const consume = (line: string): void => {
        if (!line.trim()) return;
        let value: unknown;
        try {
          value = JSON.parse(line) as unknown;
        } catch {
          process.stdout.write(`${line}\n`);
          return;
        }
        for (const event of interpretAgentEvents(this.agentId, value)) this.onEvent(event);
      };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        if (failed) return;
        try {
          pending += chunk;
          while (pending.includes('\n')) {
            const index = pending.indexOf('\n');
            const line = pending.slice(0, index);
            pending = pending.slice(index + 1);
            if (line.length > 1_000_000) throw new Error('Provider event is too large.');
            consume(line);
          }
          if (pending.length > 1_000_000) throw new Error('Provider event is too large.');
        } catch (error: unknown) {
          failed = true;
          child.kill();
          reject(error);
        }
      });
      child.once('error', reject);
      child.once('close', (code) => {
        if (failed) return;
        try {
          consume(pending);
          resolve(code ?? 1);
        } catch (error: unknown) {
          reject(error);
        }
      });
    });
  }
}
