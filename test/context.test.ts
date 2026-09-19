import { describe, expect, it } from 'vitest';
import { buildContext, excluded, redact, safeDiff } from '../src/application/context.js';
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
    expect(redact('api_key = \"quoted-secret\"')).not.toContain('quoted-secret');
  });
});
