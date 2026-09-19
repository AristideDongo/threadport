import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { Forks } from '../src/application/forks.js';
import { ThreadPort } from '../src/application/threadport.js';
import { SessionTransfer } from '../src/application/transfer.js';
import { GitCliReader } from '../src/infrastructure/git.js';
import { GitWorktrees } from '../src/infrastructure/git-worktrees.js';
import { SqliteStore } from '../src/infrastructure/sqlite-store.js';
import { interpretAgentEvent } from '../src/infrastructure/structured-agent.js';
import { readConfig, setDefaultMode } from '../src/infrastructure/config.js';
import { loadExcludes } from '../src/infrastructure/privacy.js';

it('migrates a v1 database and searches structured records', () => {
  const dir = mkdtempSync(join(tmpdir(), 'threadport-migration-'));
  const path = join(dir, 'db.sqlite');
  try {
    const old = new DatabaseSync(path);
    old.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE decisions (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, title TEXT NOT NULL, rationale TEXT NOT NULL, created_at TEXT NOT NULL); INSERT INTO sessions VALUES ('s1','Legacy','active','2026-01-01','2026-01-01'); PRAGMA user_version=1;");
    old.close();
    const store = new SqliteStore(path);
    const app = new ThreadPort(store, { read: () => null }, dir);
    app.addRecord('note', 'Refresh rotation', 'Race condition');
    expect(app.search('rotation')[0]?.title).toBe('Refresh rotation');
    expect(app.contextPack('minimal', []).tokens).toBeLessThanOrEqual(500);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('creates isolated forks and compares their actual changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'threadport-fork-test-'));
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    git('init', '-q'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test');
    writeFileSync(join(dir, '.gitignore'), '.threadport/\n');
    writeFileSync(join(dir, 'app.txt'), 'base\n');
    git('add', '.'); git('commit', '-qm', 'base');
    const store = new SqliteStore(join(dir, '.threadport', 'db.sqlite'));
    const app = new ThreadPort(store, new GitCliReader(), dir);
    app.newSession('Compare');
    const forks = new Forks(store, new GitCliReader(), new GitWorktrees(), dir);
    const [first, second] = forks.create(['claude', 'codex']);
    if (!first || !second) throw new Error('Fork missing');
    writeFileSync(join(first.path, 'app.txt'), 'changed\n');
    writeFileSync(join(first.path, 'new.txt'), 'new content\n');
    const compared = forks.compare(first.id, second.id);
    expect(compared[0]?.stats.files).toBe(2);
    expect(compared[1]?.stats.files).toBe(0);
    expect(forks.diff(first.id)).toContain('new content');
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }).trim()).toBe('');
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('normalizes provider event streams without storing raw JSON', () => {
  expect(interpretAgentEvent('codex', { type: 'thread.started', thread_id: 'abc' })?.body).toBe('abc');
  expect(interpretAgentEvent('codex', { type: 'item.completed', item: { type: 'command_execution', command: 'npm test', aggregated_output: 'ok' } })?.kind).toBe('command');
  expect(interpretAgentEvent('claude', { type: 'result', result: 'Done', is_error: false })?.body).toBe('Done');
  expect(interpretAgentEvent('claude', { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } })?.title).toBe('npm test');
});

it('applies project configuration to privacy exclusions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'threadport-config-'));
  const store = new SqliteStore(join(dir, '.threadport', 'db.sqlite'));
  try {
    expect(readConfig(dir).context.defaultMode).toBe('standard');
    setDefaultMode(dir, 'deep');
    writeFileSync(join(dir, '.threadport', 'config.json'), JSON.stringify({ context: { defaultMode: 'deep' }, privacy: { exclude: ['private/**'] } }));
    expect(readConfig(dir).context.defaultMode).toBe('deep');
    expect(loadExcludes(dir)).toContain('private/**');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('reads renamed Git paths without splitting unusual filenames', () => {
  const dir = mkdtempSync(join(tmpdir(), 'threadport-git-path-'));
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    git('init', '-q'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test');
    writeFileSync(join(dir, 'old name.txt'), 'base\n');
    git('add', '.'); git('commit', '-qm', 'base');
    git('mv', 'old name.txt', 'new name.txt');
    expect(new GitCliReader().read(dir)?.changedFiles).toEqual(['new name.txt']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('exports and imports a session with remapped identifiers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'threadport-transfer-'));
  const source = new SqliteStore(join(dir, 'source.sqlite'));
  const target = new SqliteStore(join(dir, 'target.sqlite'));
  try {
    const app = new ThreadPort(source, { read: () => null }, dir);
    const original = app.newSession('Portable task');
    app.decide('Use SQLite', 'Offline storage');
    app.addRecord('task', 'Write tests', '', 'open');
    const archive = new SessionTransfer(source).export(original.id);
    const imported = new SessionTransfer(target).import(JSON.parse(JSON.stringify(archive)) as unknown);
    expect(imported.id).not.toBe(original.id);
    expect(target.listDecisions(imported.id)[0]?.title).toBe('Use SQLite');
    expect(target.listRecords(imported.id)[0]?.title).toBe('Write tests');
    expect(target.search('SQLite', 10)[0]?.sessionId).toBe(imported.id);
  } finally { source.close(); target.close(); rmSync(dir, { recursive: true, force: true }); }
});
