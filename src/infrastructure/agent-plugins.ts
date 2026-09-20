import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentAdapter } from '../application/ports.js';

interface AgentManifest { version: 1; id: string; label: string; command: string; args: string[]; capabilities: string[]; }
function manifest(value: unknown): AgentManifest {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid agent manifest.');
  const item = value as Record<string, unknown>;
  if (item.version !== 1 || typeof item.id !== 'string' || !/^[a-z][a-z0-9_-]{1,30}$/.test(item.id) || typeof item.label !== 'string' || typeof item.command !== 'string' || !item.command || !Array.isArray(item.args) || !item.args.every((arg) => typeof arg === 'string') || !Array.isArray(item.capabilities) || !item.capabilities.every((capability) => typeof capability === 'string')) throw new Error('Invalid agent manifest: version, id, label, command, args, and capabilities are required.');
  return item as unknown as AgentManifest;
}
export function loadAgentPlugins(projectDir: string): AgentAdapter[] {
  const directory = join(projectDir, 'plugins');
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => name.endsWith('.json')).map((name) => {
    const value = manifest(JSON.parse(readFileSync(join(directory, name), 'utf8')) as unknown);
    return { id: value.id, label: value.label, command: value.command, capabilities: value.capabilities, args: (contextFile: string) => value.args.map((arg) => arg.replaceAll('{contextFile}', contextFile)) };
  });
}
export function installAgentPlugin(projectDir: string, file: string): AgentManifest {
  const value = manifest(JSON.parse(readFileSync(file, 'utf8')) as unknown);
  const directory = join(projectDir, 'plugins');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  copyFileSync(file, join(directory, `${value.id}.json`));
  return value;
}
