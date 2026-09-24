import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ThreadPort } from '../src/application/threadport.js';
import { SessionTransfer } from '../src/application/transfer.js';
import { GitCliReader } from '../src/infrastructure/git.js';
import { SqliteStore } from '../src/infrastructure/sqlite-store.js';

it('binds verification to Git state and carries a reviewed handoff through export', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'threadport-continuity-'));
  const store = new SqliteStore(join(dir, '.threadport', 'threadport.sqlite'));
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    writeFileSync(join(dir, '.gitignore'), '.threadport/\n');
    writeFileSync(join(dir, 'app.txt'), 'base\n');
    git('add', '.');
    git('commit', '-qm', 'base');
    const app = new ThreadPort(store, new GitCliReader(), dir);
    const session = app.newSession('Ship a safe change');
    app.addRecord('task', 'Review the patch', '', 'open');
    expect(app.linkWork('issue', 'https://github.com/example/repo/issues/42').title).toBe('Issue #42');
    expect(() => app.linkWork('pr', 'https://github.com/example/repo/issues/42')).toThrow('canonical');
    const report = await app.verify([{ command: 'test-tool', args: ['check'] }], {
      execute: async () => ({ code: 0, output: 'pass' }),
    });
    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(1);
    expect(app.verificationStatus()?.current).toBe(true);
    const draft = app.handoffDraft();
    expect(draft).toContain('Passed on the current Git state');
    expect(draft).toContain('https://github.com/example/repo/issues/42');
    app.saveHandoff(`${draft}\n\nHuman review: accepted.`);
    expect(app.latestHandoff()).toMatchObject({ stale: false });
    expect(app.context('standard', [])).toContain('Human review: accepted.');
    const archive = new SessionTransfer(store).export(session.id);
    const target = new SqliteStore(join(dir, 'copy.sqlite'));
    try {
      const imported = new SessionTransfer(target).import(archive);
      expect(target.listRecords(imported.id).some((item) => item.kind === 'handoff')).toBe(true);
      expect(target.listRecords(imported.id).some((item) => item.kind === 'verification')).toBe(true);
    } finally {
      target.close();
    }
    writeFileSync(join(dir, 'app.txt'), 'changed\n');
    expect(app.verificationStatus()?.current).toBe(false);
    expect(app.latestHandoff()).toMatchObject({ stale: true });
    expect(app.handoffDraft()).toContain('Unverified or stale');
    expect(() => app.saveHandoff(draft)).toThrow('stale');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('records failed commands and audits historical privacy risks without exposing values', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'threadport-verify-failure-'));
  const store = new SqliteStore(join(dir, '.threadport', 'threadport.sqlite'));
  try {
    const app = new ThreadPort(store, { read: () => null }, dir, ['.env']);
    const session = app.newSession('Check evidence');
    const report = await app.verify([{ command: 'missing-tool', args: [] }], {
      execute: async () => {
        throw new Error('not installed');
      },
    });
    expect(report.passed).toBe(false);
    expect(report.results[0]?.exitCode).toBe(127);
    store.addRecord({
      id: 'legacy-secret',
      sessionId: session.id,
      runId: null,
      kind: 'note',
      title: 'token=private-value',
      body: '',
      status: 'info',
      createdAt: '2026-01-01',
    });
    store.addRecord({
      id: 'legacy-file',
      sessionId: session.id,
      runId: null,
      kind: 'file',
      title: '.env',
      body: '',
      status: 'info',
      createdAt: '2026-01-01',
    });
    const audit = app.privacyAudit();
    expect(audit.redactedFields).toBeGreaterThan(0);
    expect(audit.excludedReferences).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain('private-value');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
