import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertMode, type ContextMode } from '../domain/model.js';

export interface ProjectConfig { context: { defaultMode: ContextMode }; privacy: { exclude: string[] }; }
const defaults: ProjectConfig = { context: { defaultMode: 'standard' }, privacy: { exclude: [] } };
export function readConfig(cwd: string): ProjectConfig {
  const path = join(cwd, '.threadport', 'config.json');
  if (!existsSync(path)) return { context: { ...defaults.context }, privacy: { exclude: [] } };
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid ThreadPort configuration.');
  const value = raw as Record<string, unknown>;
  const context = typeof value.context === 'object' && value.context !== null ? value.context as Record<string, unknown> : {};
  const privacy = typeof value.privacy === 'object' && value.privacy !== null ? value.privacy as Record<string, unknown> : {};
  const mode = assertMode(typeof context.defaultMode === 'string' ? context.defaultMode : 'standard');
  const exclude = privacy.exclude ?? [];
  if (!Array.isArray(exclude) || !exclude.every((item) => typeof item === 'string')) throw new Error('privacy.exclude must be a list of paths.');
  return { context: { defaultMode: mode }, privacy: { exclude } };
}
export function setDefaultMode(cwd: string, mode: ContextMode): ProjectConfig {
  const config = readConfig(cwd);
  config.context.defaultMode = mode;
  writeFileSync(join(cwd, '.threadport', 'config.json'), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  return config;
}
