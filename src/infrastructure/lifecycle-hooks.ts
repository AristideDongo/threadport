import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { ThreadPort } from '../application/threadport.js';
import { excluded, redact } from '../application/context.js';
import { loadExcludes } from './privacy.js';
import { readConfig } from './config.js';

type Provider = 'claude' | 'codex';
type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject | null { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : null; }
function string(value: unknown): string { return typeof value === 'string' ? value : ''; }

export function findProjectRoot(start: string): string | null {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, '.threadport', 'threadport.sqlite'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function installLifecycleHooks(root: string, provider: Provider): string {
  const target = provider === 'claude' ? '.claude/settings.local.json' : '.codex/hooks.json';
  const path = join(root, target);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const existing: unknown = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as unknown : {};
  const config = object(existing);
  if (!config) throw new Error(`Invalid JSON object in ${target}.`);
  if (config.hooks !== undefined && !object(config.hooks)) throw new Error(`Invalid hooks object in ${target}.`);
  const hooks = object(config.hooks) ?? {};
  for (const event of ['SessionStart', 'PostToolUse', 'SessionEnd']) {
    const entries = hooks[event];
    if (entries !== undefined && !Array.isArray(entries)) throw new Error(`Invalid ${event} hooks in ${target}.`);
    const list: unknown[] = Array.isArray(entries) ? entries : [];
    const command = `threadport hook ingest ${provider}`;
    const present = list.some((entry) => {
      const handlers = object(entry)?.hooks;
      return Array.isArray(handlers) && handlers.some((handler) => object(handler)?.command === command);
    });
    if (!present) list.push({ ...(event === 'PostToolUse' ? { matcher: '^(Write|Edit|MultiEdit|ApplyPatch|apply_patch|functions\\.apply_patch)$' } : {}), hooks: [{ type: 'command', command, timeout: event === 'SessionEnd' ? 3 : 10 }] });
    hooks[event] = list;
  }
  config.hooks = hooks;
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  const gitExclude = join(root, '.git', 'info', 'exclude');
  if (existsSync(gitExclude)) {
    const line = `/${target.replaceAll('\\', '/')}\n`;
    if (!readFileSync(gitExclude, 'utf8').split(/\r?\n/).includes(line.trim())) appendFileSync(gitExclude, line);
  }
  return path;
}

export function handleLifecycleHook(app: ThreadPort, root: string, provider: Provider, input: unknown): string | null {
  const event = object(input);
  if (!event || !app.active()) return null;
  const name = string(event.hook_event_name);
  if (name === 'SessionStart') {
    const context = app.context(readConfig(root).context.defaultMode, loadExcludes(root));
    return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } });
  }
  if (name === 'PostToolUse') {
    const tool = string(event.tool_name);
    if (!['Write', 'Edit', 'MultiEdit', 'ApplyPatch', 'apply_patch', 'functions.apply_patch'].includes(tool)) return null;
    const inputObject = object(event.tool_input);
    const rawPath = string(inputObject?.file_path) || string(inputObject?.path);
    if (!rawPath) { app.addRecord('note', `${provider} ${tool} completed`); return null; }
    const path = relative(root, resolve(root, rawPath));
    if (!path || path === '..' || path.startsWith(`..${sep}`) || excluded(path.replaceAll('\\', '/'), loadExcludes(root))) return null;
    app.addRecord('file', path.replaceAll('\\', '/'), `${provider} ${redact(tool)} completed`);
  }
  if (name === 'SessionEnd') app.summarize();
  return null;
}
