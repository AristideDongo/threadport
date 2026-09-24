import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SqliteStore } from '../src/infrastructure/sqlite-store.js';

const tsxLoader = import.meta.resolve('tsx');

it('serves authenticated session and task workflows over HTTP', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'threadport-api-test-'));
  const store = new SqliteStore(join(cwd, '.threadport', 'threadport.sqlite'));
  store.close();
  let child: ReturnType<typeof spawn> | undefined;
  try {
    child = spawn(process.execPath, ['--import', tsxLoader, join(process.cwd(), 'src', 'interfaces', 'cli', 'main.ts'), 'serve'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const ready = await new Promise<{ url: string; token: string }>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`API startup timed out: ${output}`)), 10_000);
      child.stdout?.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
        const url = /ThreadPort API: (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];
        const token = /Bearer token: ([a-f0-9]+)/.exec(output)?.[1];
        if (url && token) { clearTimeout(timer); resolve({ url, token }); }
      });
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`API exited with code ${code}: ${output}`)); });
    });
    const request = (path: string, method = 'GET', body?: object) => fetch(`${ready.url}${path}`, {
      method,
      headers: { Authorization: `Bearer ${ready.token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    expect((await fetch(`${ready.url}/v1/status`)).status).toBe(401);
    const created = await request('/v1/sessions', 'POST', { title: 'API workflow' });
    expect(created.status).toBe(201);
    const session = await created.json() as { id: string };
    const taskResponse = await request('/v1/tasks', 'POST', { title: 'Write API test' });
    expect(taskResponse.status).toBe(201);
    const task = await taskResponse.json() as { id: string };
    const completed = await request('/v1/tasks/complete', 'POST', { id: task.id });
    expect((await completed.json() as { status: string }).status).toBe('done');
    const summary = await request('/v1/summary', 'POST');
    expect((await summary.json() as { body: string }).body).toContain('Write API test');
    expect((await request('/v1/runs')).status).toBe(200);
    expect((await request('/v1/sessions/open', 'POST', { id: session.id })).status).toBe(200);
    const updated = await request('/v1/records/update', 'POST', { id: task.id, title: 'Write broader API test' });
    expect((await updated.json() as { title: string }).title).toBe('Write broader API test');
    expect((await request('/v1/sessions/finish', 'POST', { id: session.id })).status).toBe(200);
    expect((await request('/v1/sessions/open', 'POST', { id: session.id })).status).toBe(200);
    expect((await request('/v1/links', 'POST', { kind: 'issue', url: 'https://github.com/example/repo/issues/42' })).status).toBe(201);
    const draftResponse = await request('/v1/handoff/draft');
    const draft = await draftResponse.json() as { content: string };
    expect(draft.content).toContain('Issue #42');
    expect((await request('/v1/handoff', 'POST', { content: draft.content })).status).toBe(201);
    expect((await request('/v1/handoff')).status).toBe(200);
    expect((await request('/v1/privacy/audit')).status).toBe(200);
    expect((await request('/v1/verification')).status).toBe(200);
    expect((await request('/v1/notes', 'POST', { title: 'Oversized', body: 'x'.repeat(65_000) })).status).toBe(413);
    expect((await request('/v1/handoff', 'POST', { content: 'x'.repeat(65_000) })).status).toBe(413);
    expect((await request('/v1/unknown')).status).toBe(404);
    expect((await request('/v1/notes', 'POST', { title: '' })).status).toBe(400);
  } finally {
    if (child && child.exitCode === null) {
      const closed = new Promise<void>((resolve) => child?.once('close', () => resolve()));
      child.kill('SIGTERM');
      await closed;
    }
    rmSync(cwd, { recursive: true, force: true });
  }
});

it('exposes session and task workflows through MCP', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'threadport-mcp-test-'));
  const store = new SqliteStore(join(cwd, '.threadport', 'threadport.sqlite'));
  store.close();
  const client = new Client({ name: 'threadport-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', tsxLoader, join(process.cwd(), 'src', 'interfaces', 'cli', 'main.ts'), 'mcp'],
    cwd,
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain('threadport_complete_task');
    expect(tools.tools.map((tool) => tool.name)).toContain('threadport_handoff_draft');
    const created = await client.callTool({ name: 'threadport_new_session', arguments: { title: 'MCP workflow' } });
    expect(JSON.stringify(created.content)).toContain('MCP workflow');
    const resources = await client.listResources();
    expect(resources.resources.map((resource) => resource.uri)).toContain('threadport://context');
    expect(resources.resources.map((resource) => resource.uri)).toContain('threadport://handoff');
    const context = await client.readResource({ uri: 'threadport://context' });
    expect(JSON.stringify(context.contents)).toContain('MCP workflow');
    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((prompt) => prompt.name)).toContain('continue-task');
    const handoff = await client.callTool({ name: 'threadport_handoff_draft', arguments: {} });
    expect(JSON.stringify(handoff.content)).toContain('MCP workflow');
    const privacy = await client.callTool({ name: 'threadport_privacy_audit', arguments: {} });
    expect(JSON.stringify(privacy.content)).toContain('contextTokens');
    const task = await client.callTool({ name: 'threadport_add_task', arguments: { title: 'Verify MCP' } });
    const taskText = task.content.find((item) => item.type === 'text');
    if (taskText?.type !== 'text') throw new Error('Task response missing');
    const parsed: unknown = JSON.parse(taskText.text);
    if (typeof parsed !== 'object' || parsed === null || !('id' in parsed) || typeof parsed.id !== 'string') throw new Error('Task ID missing');
    const completed = await client.callTool({ name: 'threadport_complete_task', arguments: { id: parsed.id } });
    const completedText = completed.content.find((item) => item.type === 'text');
    if (completedText?.type !== 'text') throw new Error('Completed task response missing');
    const completedTask: unknown = JSON.parse(completedText.text);
    expect(completedTask).toMatchObject({ status: 'done' });
  } finally {
    await client.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});
