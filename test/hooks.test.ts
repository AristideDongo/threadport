import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ThreadPort } from '../src/application/threadport.js';
import { SqliteStore } from '../src/infrastructure/sqlite-store.js';
import { handleLifecycleHook, installLifecycleHooks } from '../src/infrastructure/lifecycle-hooks.js';

it('installs hooks without replacing existing settings and captures only allowed file metadata', () => {
  const dir = mkdtempSync(join(tmpdir(), 'threadport-hooks-'));
  const store = new SqliteStore(join(dir, '.threadport', 'threadport.sqlite'));
  try {
    mkdirSync(join(dir, '.claude'));
    writeFileSync(join(dir, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Read'] } }));
    const path = installLifecycleHooks(dir, 'claude');
    installLifecycleHooks(dir, 'claude');
    const config = JSON.parse(readFileSync(path, 'utf8')) as {
      permissions: { allow: string[] };
      hooks: { PostToolUse: unknown[] };
    };
    expect(config.permissions.allow).toEqual(['Read']);
    expect(config.hooks.PostToolUse).toHaveLength(1);
    const app = new ThreadPort(store, { read: () => null }, dir, ['.env']);
    const session = app.newSession('Hook capture');
    const output = handleLifecycleHook(app, dir, 'claude', { hook_event_name: 'SessionStart' });
    expect(output).toContain('Hook capture');
    handleLifecycleHook(app, dir, 'claude', {
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_input: { file_path: join(dir, '.env') },
      tool_response: { content: 'password: private' },
    });
    handleLifecycleHook(app, dir, 'claude', {
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_input: { file_path: join(dir, 'src', 'main.ts') },
      tool_response: { content: 'password: private' },
    });
    expect(JSON.stringify(app.records(session.id))).toContain('src/main.ts');
    expect(JSON.stringify(app.records(session.id))).not.toContain('private');
    expect(JSON.stringify(app.records(session.id))).not.toContain('.env');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
