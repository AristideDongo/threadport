import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildContextPack, gitFingerprint, redact } from '../src/application/context.js';
import { ThreadPort } from '../src/application/threadport.js';
import type { GitReader } from '../src/application/ports.js';
import { SqliteStore } from '../src/infrastructure/sqlite-store.js';

const loader = import.meta.resolve('tsx');
const cli = join(process.cwd(), 'src', 'interfaces', 'cli', 'main.ts');
const noGit: GitReader = { read: () => null };

function withStore(test: (store: SqliteStore, dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'threadport-hardening-'));
  const store = new SqliteStore(join(dir, 'db.sqlite'));
  try { test(store, dir); } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
}

describe('record deletion', () => {
  it('keeps unrelated events whose message matches the record title', () => withStore((store, dir) => {
    const app = new ThreadPort(store, noGit, dir);
    const session = app.newSession('Fix login');
    const note = app.addRecord('note', 'Fix login');
    app.deleteRecord(note.id);
    const types = app.events(session.id).map((event) => event.type);
    expect(types).toContain('SessionCreated');
    expect(types).not.toContain('NoteRecorded');
    expect(types).toContain('RecordDeleted');
  }));
});

describe('store transactions', () => {
  it('lets nested writes join the outer transaction and roll back together', () => withStore((store) => {
    store.createSession({ id: 's1', title: 'Outer', status: 'paused', createdAt: '2026-01-01', updatedAt: '2026-01-01' });
    expect(() => store.transaction(() => {
      store.addDecision({ id: 'd1', sessionId: 's1', title: 'Nested', rationale: '', createdAt: '2026-01-02' });
      throw new Error('abort');
    })).toThrow('abort');
    expect(store.listDecisions('s1')).toEqual([]);
    expect(store.search('Nested', 10)).toEqual([]);
  }));
});

describe('redaction', () => {
  it.each([
    ['GitHub fine-grained token', 'github_pat_11ABCDEFGHIJKLMNOPQRSTUV_abcdefghijklmnop'],
    ['AWS access key', 'AKIAIOSFODNN7EXAMPLE'],
    ['Slack token', 'xoxb-123456789012-abcdefghij'],
    ['Google API key', 'AIzaSyA1234567890abcdefghijklmnopqrstuv'],
    ['GitLab token', 'glpat-abcdefghij1234567890'],
    ['npm token', 'npm_abcdefghijklmnopqrstuvwxyz0123456789'],
    ['Stripe key', 'sk_live_abcdefghijklmnop1234'],
    ['JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'],
    ['bearer header', 'Authorization: Bearer abcdefghijklmnopqrstuvwx'],
  ])('redacts a %s', (_label, secret) => {
    const secretPart = secret.replace(/^Authorization: Bearer /, '');
    expect(redact(`value ${secret} end`)).not.toContain(secretPart);
  });

  it('keeps the URL host when removing embedded credentials', () => {
    expect(redact('git clone https://alice:hunter2@github.com/org/repo')).toBe('git clone https://[REDACTED]@github.com/org/repo');
  });
});

describe('partial Git state', () => {
  it('never produces a fingerprint and warns in the context', () => withStore((store, dir) => {
    const git = { branch: 'main', head: 'abc', changedFiles: [], diff: '', warning: 'Too many changed or untracked files to read.' };
    expect(gitFingerprint(git)).toBeNull();
    const app = new ThreadPort(store, { read: () => git }, dir);
    const session = app.newSession('Large repository');
    expect(buildContextPack(store, session, git, 'standard', []).text).toContain('⚠ Too many changed');
  }));
});

describe('CLI', () => {
  const run = (cwd: string, env: NodeJS.ProcessEnv, ...args: string[]) => spawnSync(process.execPath, ['--import', loader, cli, ...args], { cwd, encoding: 'utf8', timeout: 20_000, env: { ...process.env, ...env } });
  const ok = (cwd: string, env: NodeJS.ProcessEnv, ...args: string[]) => {
    const result = run(cwd, env, ...args);
    if (result.status !== 0) throw new Error(`${args.join(' ')}: ${result.stderr || result.stdout}`);
    return result;
  };

  it('finds the project from a subdirectory, keeps data out of Git, and hides the SQLite warning', () => {
    const dir = mkdtempSync(join(tmpdir(), 'threadport-cli-root-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      const init = ok(dir, {}, 'init');
      expect(init.stderr).not.toContain('ExperimentalWarning');
      expect(readFileSync(join(dir, '.threadport', '.gitignore'), 'utf8')).toContain('*');
      expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' })).not.toContain('.threadport');
      const sub = join(dir, 'src', 'auth');
      mkdirSync(sub, { recursive: true });
      ok(dir, {}, 'new', 'Root discovery');
      expect(ok(sub, {}, 'status').stdout).toContain('Root discovery');
      ok(sub, {}, 'file', 'token.ts');
      expect(ok(dir, {}, 'files').stdout).toContain('src/auth/token.ts');
      expect(existsSync(join(sub, '.threadport'))).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);

  it('refuses to run project agent manifests until the user trusts them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'threadport-cli-trust-'));
    const home = mkdtempSync(join(tmpdir(), 'threadport-home-'));
    const env = { THREADPORT_HOME: home };
    try {
      ok(dir, env, 'init');
      ok(dir, env, 'new', 'Plugin trust');
      // Simulates a manifest that arrived with a cloned repository instead of "plugin add".
      mkdirSync(join(dir, '.threadport', 'plugins'));
      const manifest = join(dir, '.threadport', 'plugins', 'local.json');
      writeFileSync(manifest, JSON.stringify({ version: 1, id: 'local', label: 'Local', command: 'git', args: ['--version'], capabilities: [] }));
      const refused = run(dir, env, 'run', 'local');
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain('threadport plugin trust local');
      expect(ok(dir, env, 'plugin', 'list').stdout).toContain('(untrusted)');
      expect(ok(dir, env, 'doctor').stdout).toContain('untrusted');
      ok(dir, env, 'plugin', 'trust', 'local');
      expect(ok(dir, env, 'run', 'local').stdout).toContain('finished (completed');
      writeFileSync(manifest, JSON.stringify({ version: 1, id: 'local', label: 'Local', command: 'git', args: ['status'], capabilities: [] }));
      expect(run(dir, env, 'run', 'local').stderr).toContain('not trusted');
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); }
  }, 60_000);
});
