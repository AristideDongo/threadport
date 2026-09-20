import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ThreadPort } from '../../application/threadport.js';
import { loadExcludes } from '../../infrastructure/privacy.js';
import { readConfig } from '../../infrastructure/config.js';
import { packageVersion } from '../../infrastructure/package-info.js';
import { z } from 'zod';

export async function serveMcp(app: ThreadPort, cwd: string): Promise<void> {
  const server = new McpServer({ name: 'threadport', version: packageVersion });
  server.registerResource('active-context', 'threadport://context', { description: 'Current redacted ThreadPort context pack', mimeType: 'text/markdown' }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: app.context(readConfig(cwd).context.defaultMode, loadExcludes(cwd)) }] }));
  server.registerResource('saved-handoff', 'threadport://handoff', { description: 'Latest saved handoff, if available', mimeType: 'text/markdown' }, async (uri) => { const handoff = app.latestHandoff(); return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: handoff ? `${handoff.stale ? '⚠ Handoff may be stale; review current files.\n\n' : ''}${handoff.content}` : '' }] }; });
  server.registerPrompt('continue-task', { description: 'Continue the active project task using its recorded context' }, async () => ({ messages: [{ role: 'user', content: { type: 'text', text: `Read the ThreadPort context below, verify the current files, then continue the task.\n\n${app.context(readConfig(cwd).context.defaultMode, loadExcludes(cwd))}` } }] }));
  server.registerTool('threadport_status', { description: 'Current local ThreadPort session' }, async () => ({ content: [{ type: 'text', text: JSON.stringify(app.active()) }] }));
  server.registerTool('threadport_sessions', { description: 'List local ThreadPort sessions' }, async () => ({ content: [{ type: 'text', text: JSON.stringify(app.sessions()) }] }));
  server.registerTool('threadport_new_session', { description: 'Create and activate a session', inputSchema: { title: z.string().min(1).max(200) } }, async ({ title }) => ({ content: [{ type: 'text', text: JSON.stringify(app.newSession(title)) }] }));
  server.registerTool('threadport_open_session', { description: 'Activate an existing session', inputSchema: { id: z.string().min(1).max(200) } }, async ({ id }) => ({ content: [{ type: 'text', text: JSON.stringify(app.open(id)) }] }));
  server.registerTool('threadport_finish_session', { description: 'Mark a session as finished', inputSchema: { id: z.string().min(1).max(200) } }, async ({ id }) => ({ content: [{ type: 'text', text: JSON.stringify(app.finish(id)) }] }));
  server.registerTool('threadport_rename_session', { description: 'Rename a session', inputSchema: { id: z.string().min(1).max(200), title: z.string().min(1).max(200) } }, async ({ id, title }) => ({ content: [{ type: 'text', text: JSON.stringify(app.rename(id, title)) }] }));
  server.registerTool('threadport_delete_session', { description: 'Permanently delete a session and its history', inputSchema: { id: z.string().min(1).max(200) } }, async ({ id }) => { app.deleteSession(id); return { content: [{ type: 'text', text: 'Session deleted.' }] }; });
  server.registerTool('threadport_context', { description: 'Current redacted context pack' }, async () => ({ content: [{ type: 'text', text: app.context(readConfig(cwd).context.defaultMode, loadExcludes(cwd)) }] }));
  server.registerTool('threadport_handoff_draft', { description: 'Draft a sourced cross-agent handoff for human review' }, async () => ({ content: [{ type: 'text', text: app.handoffDraft() }] }));
  server.registerTool('threadport_save_handoff', { description: 'Save a Markdown handoff draft', inputSchema: { content: z.string().min(1).max(18_000) } }, async ({ content }) => ({ content: [{ type: 'text', text: JSON.stringify(app.saveHandoff(content)) }] }));
  server.registerTool('threadport_verification', { description: 'Read the latest verification report and whether it still matches Git state' }, async () => ({ content: [{ type: 'text', text: JSON.stringify(app.verificationStatus()) }] }));
  server.registerTool('threadport_privacy_audit', { description: 'Preview redactions and excluded references before sharing' }, async () => ({ content: [{ type: 'text', text: JSON.stringify(app.privacyAudit()) }] }));
  server.registerTool('threadport_link_github', { description: 'Link the active session to a GitHub issue or pull request', inputSchema: { kind: z.enum(['issue', 'pr']), url: z.string().url().max(500) } }, async ({ kind, url }) => ({ content: [{ type: 'text', text: JSON.stringify(app.linkWork(kind, url)) }] }));
  server.registerTool('threadport_timeline', { description: 'Timeline of the current session' }, async () => {
    const current = app.active();
    return { content: [{ type: 'text', text: JSON.stringify(current ? app.events(current.id) : []) }] };
  });
  server.registerTool('threadport_decisions', { description: 'Decisions of the current session' }, async () => {
    const current = app.active();
    return { content: [{ type: 'text', text: JSON.stringify(current ? app.decisions(current.id) : []) }] };
  });
  server.registerTool('threadport_records', { description: 'Records of the current session' }, async () => {
    const current = app.active();
    return { content: [{ type: 'text', text: JSON.stringify(current ? app.records(current.id) : []) }] };
  });
  server.registerTool('threadport_runs', { description: 'Agent runs of the current session' }, async () => {
    const current = app.active();
    return { content: [{ type: 'text', text: JSON.stringify(current ? app.runs(current.id) : []) }] };
  });
  server.registerTool('threadport_search', { description: 'Search local ThreadPort memory', inputSchema: { query: z.string().min(1).max(200) } }, async ({ query }) => ({ content: [{ type: 'text', text: JSON.stringify(app.search(query)) }] }));
  server.registerTool('threadport_add_note', { description: 'Save a note in the current session', inputSchema: { title: z.string().min(1).max(200), body: z.string().max(20_000).optional() } }, async ({ title, body }) => ({ content: [{ type: 'text', text: JSON.stringify(app.addRecord('note', title, body ?? '')) }] }));
  server.registerTool('threadport_add_task', { description: 'Create an open task in the current session', inputSchema: { title: z.string().min(1).max(200) } }, async ({ title }) => ({ content: [{ type: 'text', text: JSON.stringify(app.addRecord('task', title, '', 'open')) }] }));
  server.registerTool('threadport_complete_task', { description: 'Complete a task in the current session', inputSchema: { id: z.string().min(1).max(200) } }, async ({ id }) => ({ content: [{ type: 'text', text: JSON.stringify(app.completeTask(id)) }] }));
  server.registerTool('threadport_update_record', { description: 'Correct a record in the current session', inputSchema: { id: z.string().min(1).max(200), title: z.string().min(1).max(200), body: z.string().max(20_000).optional() } }, async ({ id, title, body }) => ({ content: [{ type: 'text', text: JSON.stringify(app.updateRecord(id, title, body)) }] }));
  server.registerTool('threadport_delete_record', { description: 'Delete a record in the current session', inputSchema: { id: z.string().min(1).max(200) } }, async ({ id }) => { app.deleteRecord(id); return { content: [{ type: 'text', text: 'Record deleted.' }] }; });
  server.registerTool('threadport_summary', { description: 'Create a summary from recorded work', }, async () => ({ content: [{ type: 'text', text: JSON.stringify(app.summarize()) }] }));
  server.registerTool('threadport_add_decision', { description: 'Record a technical decision in the current session', inputSchema: { title: z.string().min(1).max(200), rationale: z.string().max(20_000).optional() } }, async ({ title, rationale }) => { app.decide(title, rationale ?? ''); return { content: [{ type: 'text', text: 'Decision recorded.' }] }; });
  await server.connect(new StdioServerTransport());
  await new Promise<void>((resolve) => process.stdin.once('end', resolve));
  await server.close();
}
