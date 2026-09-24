import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AgentAdapter } from '../application/ports.js';

interface AgentManifest { version: 1; id: string; label: string; command: string; args: string[]; capabilities: string[]; }
/** A project agent adapter. Its command runs only after the user trusts this exact manifest content. */
export interface PluginAgent extends AgentAdapter { readonly manifestPath: string; readonly trusted: boolean; }
interface TrustStore { version: 1; manifests: Record<string, string>; }

function manifest(value: unknown): AgentManifest {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid agent manifest.');
  const item = value as Record<string, unknown>;
  if (item.version !== 1 || typeof item.id !== 'string' || !/^[a-z][a-z0-9_-]{1,30}$/.test(item.id) || typeof item.label !== 'string' || typeof item.command !== 'string' || !item.command || !Array.isArray(item.args) || !item.args.every((arg) => typeof arg === 'string') || !Array.isArray(item.capabilities) || !item.capabilities.every((capability) => typeof capability === 'string')) throw new Error('Invalid agent manifest: version, id, label, command, args, and capabilities are required.');
  return item as unknown as AgentManifest;
}

/** User-level state lives outside projects so a cloned repository cannot mark its own manifests as trusted. */
function trustPath(): string { return join(process.env.THREADPORT_HOME ?? join(homedir(), '.threadport'), 'trusted-agents.json'); }
function readTrust(): TrustStore {
  const path = trustPath();
  if (!existsSync(path)) return { version: 1, manifests: {} };
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof raw !== 'object' || raw === null || !('manifests' in raw) || typeof raw.manifests !== 'object' || raw.manifests === null) throw new Error(`Invalid trust store: ${path}`);
  return { version: 1, manifests: raw.manifests as Record<string, string> };
}
function digest(content: string): string { return createHash('sha256').update(content).digest('hex'); }
function trust(path: string, content: string): void {
  const store = readTrust();
  store.manifests[resolve(path)] = digest(content);
  const file = trustPath();
  mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}

export function loadAgentPlugins(projectDir: string): PluginAgent[] {
  const directory = join(projectDir, 'plugins');
  if (!existsSync(directory)) return [];
  const trusted = readTrust().manifests;
  return readdirSync(directory).filter((name) => name.endsWith('.json')).map((name) => {
    const manifestPath = resolve(directory, name);
    const content = readFileSync(manifestPath, 'utf8');
    const value = manifest(JSON.parse(content) as unknown);
    return { id: value.id, label: value.label, command: value.command, capabilities: value.capabilities, manifestPath, trusted: trusted[manifestPath] === digest(content), args: (contextFile: string) => value.args.map((arg) => arg.replaceAll('{contextFile}', contextFile)) };
  });
}
export function installAgentPlugin(projectDir: string, file: string): AgentManifest {
  const content = readFileSync(file, 'utf8');
  const value = manifest(JSON.parse(content) as unknown);
  const directory = join(projectDir, 'plugins');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = join(directory, `${value.id}.json`);
  copyFileSync(file, target);
  trust(target, content);
  return value;
}
/** Marks the current content of a project manifest as trusted; any later edit revokes it. */
export function trustAgentPlugin(projectDir: string, id: string): PluginAgent {
  const plugin = loadAgentPlugins(projectDir).find((item) => item.id === id);
  if (!plugin) throw new Error(`Unknown project agent: ${id}.`);
  trust(plugin.manifestPath, readFileSync(plugin.manifestPath, 'utf8'));
  return { ...plugin, trusted: true };
}
export function assertTrusted(agent: AgentAdapter): void {
  if ('trusted' in agent && agent.trusted === false) {
    const plugin = agent as PluginAgent;
    throw new Error(`Agent ${plugin.id} runs "${plugin.command}" from ${plugin.manifestPath}, which you have not trusted. Review the manifest, then run "threadport plugin trust ${plugin.id}".`);
  }
}
