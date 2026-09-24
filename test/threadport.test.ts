import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ThreadPort } from '../src/application/threadport.js';
import { SqliteStore } from '../src/infrastructure/sqlite-store.js';
import type { AgentAdapter, AgentRunner, GitReader } from '../src/application/ports.js';

it('creates a session and records an agent handoff', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'threadport-flow-'));
  const store = new SqliteStore(join(dir, 'db.sqlite'));
  try {
    const git: GitReader = {
      read: () => ({ branch: 'main', head: 'abc', changedFiles: ['src/a.ts'], diff: '+change' }),
    };
    const runner: AgentRunner = { available: () => true, run: async () => 0 };
    const app = new ThreadPort(store, git, dir);
    const session = app.newSession('Implement feature');
    const claude: AgentAdapter = { id: 'claude', label: 'Claude', command: 'claude', capabilities: [], args: () => [] };
    const codex: AgentAdapter = { id: 'codex', label: 'Codex', command: 'codex', capabilities: [], args: () => [] };
    await app.run(claude, runner, '/tmp/context');
    await app.run(codex, runner, '/tmp/context');
    await app.run(claude, { available: () => true, run: async () => 130 }, '/tmp/context');
    expect(app.runs(session.id).map((run) => run.agentId)).toEqual(['claude', 'codex', 'claude']);
    expect(app.runs(session.id).at(-1)?.status).toBe('cancelled');
    expect(app.events(session.id).map((event) => event.type)).toContain('AgentSwitched');
    expect(store.latestSnapshot(session.id)?.git.diff).toBe('');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('uses provider resume arguments when a session identifier is available', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'threadport-resume-'));
  const store = new SqliteStore(join(dir, 'db.sqlite'));
  try {
    const app = new ThreadPort(store, { read: () => null }, dir);
    app.newSession('Resume interrupted work');
    let received: readonly string[] = [];
    const runner: AgentRunner = {
      available: () => true,
      run: async (_command, args) => {
        received = args;
        return 0;
      },
    };
    const adapter: AgentAdapter = {
      id: 'codex',
      label: 'Codex',
      command: 'codex',
      capabilities: [],
      args: () => ['new'],
      resumeArgs: (id, context) => ['resume', id, context],
    };
    await app.run(adapter, runner, '/tmp/context.md', 'provider-42');
    expect(received).toEqual(['resume', 'provider-42', '/tmp/context.md']);
    expect(app.runs(app.active()?.id ?? '').at(-1)?.providerSessionId).toBe('provider-42');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
