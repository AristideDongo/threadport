import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertMode, type ContextMode } from '../domain/model.js';
import type { VerificationCommand } from '../application/continuity.js';

export interface ProjectConfig { context: { defaultMode: ContextMode }; privacy: { exclude: string[] }; verification: { commands: VerificationCommand[] }; }
const defaults: ProjectConfig = { context: { defaultMode: 'standard' }, privacy: { exclude: [] }, verification: { commands: [] } };
export function readConfig(cwd: string): ProjectConfig {
  const path = join(cwd, '.threadport', 'config.json');
  if (!existsSync(path)) return { context: { ...defaults.context }, privacy: { exclude: [] }, verification: { commands: [] } };
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid ThreadPort configuration.');
  const value = raw as Record<string, unknown>;
  const context = typeof value.context === 'object' && value.context !== null ? value.context as Record<string, unknown> : {};
  const privacy = typeof value.privacy === 'object' && value.privacy !== null ? value.privacy as Record<string, unknown> : {};
  const verification = typeof value.verification === 'object' && value.verification !== null ? value.verification as Record<string, unknown> : {};
  const mode = assertMode(typeof context.defaultMode === 'string' ? context.defaultMode : 'standard');
  const exclude = privacy.exclude ?? [];
  if (!Array.isArray(exclude) || !exclude.every((item) => typeof item === 'string')) throw new Error('privacy.exclude must be a list of paths.');
  const commands = verification.commands ?? [];
  if (!Array.isArray(commands) || !commands.every((item: unknown) => {
    if (typeof item !== 'object' || item === null) return false;
    const entry = item as Record<string, unknown>;
    return typeof entry.command === 'string' && Boolean(entry.command.trim()) && Array.isArray(entry.args) && entry.args.every((arg: unknown) => typeof arg === 'string');
  })) throw new Error('verification.commands must be a list of { command, args } objects.');
  return { context: { defaultMode: mode }, privacy: { exclude }, verification: { commands: commands as VerificationCommand[] } };
}
export function setDefaultMode(cwd: string, mode: ContextMode): ProjectConfig {
  const config = readConfig(cwd);
  config.context.defaultMode = mode;
  writeFileSync(join(cwd, '.threadport', 'config.json'), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return config;
}
export function verificationCommands(cwd: string): VerificationCommand[] {
  const configured = readConfig(cwd).verification.commands;
  if (configured.length) return configured;
  const path = join(cwd, 'package.json');
  if (!existsSync(path)) return [];
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof raw !== 'object' || raw === null || !('scripts' in raw) || typeof raw.scripts !== 'object' || raw.scripts === null) return [];
  const scripts = raw.scripts as Record<string, unknown>;
  return ['check', 'test', 'build'].filter((name) => typeof scripts[name] === 'string').map((name) => ({ command: 'npm', args: ['run', name] }));
}
