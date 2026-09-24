import { describe, expect, it } from 'vitest';
import { buildContext, buildContextPack, excluded, redact, safeDiff } from '../src/application/context.js';
import type { WorkRecord } from '../src/domain/model.js';
import type { Session } from '../src/domain/model.js';
import type { SessionStore } from '../src/application/ports.js';

const session: Session = { id: 's1', title: 'Fix auth', status: 'active', createdAt: '2026-01-01', updatedAt: '2026-01-01' };
const store = { listDecisions: () => [], listEvents: () => [], listRecords: () => [], listProjectMemory: () => [] } as unknown as SessionStore;

describe('context privacy', () => {
  it('excludes sensitive paths and their complete diff blocks', () => {
    const diff = 'diff --git a/.env b/.env\n+API_KEY=secret-value\ndiff --git a/src/a.ts b/src/a.ts\n+export const x = 1;';
    expect(excluded('.env', ['.env'])).toBe(true);
    expect(safeDiff(diff, ['.env'])).not.toContain('secret-value');
    expect(safeDiff('diff --git a/.env b/config.txt\n-secret-value', ['.env'])).not.toContain('secret-value');
    const context = buildContext(store, session, { branch: 'main', head: 'abc', changedFiles: ['.env', 'src/a.ts'], diff }, 'deep', ['.env']);
    expect(context).not.toContain('.env');
    expect(context).not.toContain('secret-value');
    expect(context).toContain('src/a.ts');
  });
  it('redacts common token forms', () => {
    expect(redact('token=abc123 password: xyz sk-abcdefghijklmnop')).not.toContain('abc123');
    expect(redact('token=abc123 password: xyz sk-abcdefghijklmnop')).not.toContain('abcdefghijklmnop');
    expect(redact('api_key = "quoted-secret"')).not.toContain('quoted-secret');
  });
});

it('keeps some open tasks when their section exceeds the token budget', () => {
  const tasks: WorkRecord[] = Array.from({ length: 30 }, (_, index) => ({ id: `t${index}`, sessionId: 's1', runId: null, kind: 'task', title: `Task ${index} ${'details '.repeat(20)}`, body: '', status: 'open', createdAt: '2026-01-01' }));
  const taskStore = { ...store, listRecords: () => tasks } as SessionStore;
  const pack = buildContextPack(taskStore, session, null, 'minimal', []);
  expect(pack.tokens).toBeLessThanOrEqual(500);
  expect(pack.text).toContain('Task 0');
  expect(pack.omitted.some((label) => label.startsWith('Open tasks'))).toBe(true);
});

it('warns when a stored summary was made against a different Git state', () => {
  const summary: WorkRecord = { id: 'sum', sessionId: 's1', runId: null, kind: 'summary', title: 'Summary', body: 'Done\nGit fingerprint: 0000000000000000', status: 'info', createdAt: '2026-01-01' };
  const summaryStore = { ...store, listRecords: () => [summary] } as SessionStore;
  const pack = buildContextPack(summaryStore, session, { branch: 'main', head: 'abc', changedFiles: [], diff: '' }, 'standard', []);
  expect(pack.text).toContain('may be stale');
});
