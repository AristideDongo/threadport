import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ThreadPort } from '../../application/threadport.js';
import { loadExcludes } from '../../infrastructure/privacy.js';
import { readConfig } from '../../infrastructure/config.js';
import { z } from 'zod';

export async function serveMcp(app: ThreadPort, cwd: string): Promise<void> {
  const server = new McpServer({ name: 'threadport', version: '0.2.0' });
  server.registerTool('threadport_status', { description: 'Current local ThreadPort session' }, async () => ({ content: [{ type: 'text', text: JSON.stringify(app.active()) }] }));
  server.registerTool('threadport_sessions', { description: 'List local ThreadPort sessions' }, async () => ({ content: [{ type: 'text', text: JSON.stringify(app.sessions()) }] }));
  server.registerTool('threadport_context', { description: 'Current redacted context pack' }, async () => ({ content: [{ type: 'text', text: app.context(readConfig(cwd).context.defaultMode, loadExcludes(cwd)) }] }));
  server.registerTool('threadport_timeline', { description: 'Timeline of the current session' }, async () => {
    const current = app.active();
    return { content: [{ type: 'text', text: JSON.stringify(current ? app.events(current.id) : []) }] };
  });
  server.registerTool('threadport_decisions', { description: 'Decisions of the current session' }, async () => {
    const current = app.active();
    return { content: [{ type: 'text', text: JSON.stringify(current ? app.decisions(current.id) : []) }] };
  });
  server.registerTool('threadport_search', { description: 'Search local ThreadPort memory', inputSchema: { query: z.string().min(1).max(200) } }, async ({ query }) => ({ content: [{ type: 'text', text: JSON.stringify(app.search(query)) }] }));
  server.registerTool('threadport_add_note', { description: 'Save a note in the current session', inputSchema: { title: z.string().min(1).max(200), body: z.string().max(20_000).optional() } }, async ({ title, body }) => ({ content: [{ type: 'text', text: JSON.stringify(app.addRecord('note', title, body ?? '')) }] }));
  server.registerTool('threadport_add_task', { description: 'Create an open task in the current session', inputSchema: { title: z.string().min(1).max(200) } }, async ({ title }) => ({ content: [{ type: 'text', text: JSON.stringify(app.addRecord('task', title, '', 'open')) }] }));
  server.registerTool('threadport_add_decision', { description: 'Record a technical decision in the current session', inputSchema: { title: z.string().min(1).max(200), rationale: z.string().max(20_000).optional() } }, async ({ title, rationale }) => { app.decide(title, rationale ?? ''); return { content: [{ type: 'text', text: 'Decision recorded.' }] }; });
  await server.connect(new StdioServerTransport());
  await new Promise<void>((resolve) => process.stdin.once('end', resolve));
  await server.close();
}
