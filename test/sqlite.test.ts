import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SqliteStore } from '../src/infrastructure/sqlite-store.js';
import type { AgentRun, Session } from '../src/domain/model.js';

it('persists sessions and recovers interrupted runs after reopening', () => {
  const dir = mkdtempSync(join(tmpdir(), 'threadport-test-'));
  const path = join(dir, 'project.sqlite');
  try {
    const first = new SqliteStore(path);
    const session: Session = { id: 's1', title: 'Task', status: 'active', createdAt: '2026-01-01', updatedAt: '2026-01-01' };
    const run: AgentRun = { id: 'r1', sessionId: 's1', agentId: 'claude', status: 'running', startedAt: '2026-01-01', endedAt: null, exitCode: null };
    first.createSession(session);
    first.addRun(run);
    first.close();
    const second = new SqliteStore(path);
    expect(second.recoverRuns('2026-01-02')).toBe(1);
    expect(second.recoverRuns('2026-01-03')).toBe(0);
    expect(second.listRuns('s1')[0]?.status).toBe('interrupted');
    expect(second.listEvents('s1')[0]?.type).toBe('AgentRunInterrupted');
    second.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
