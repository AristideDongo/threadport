import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ThreadPort } from '../../application/threadport.js';
import { assertMode } from '../../domain/model.js';
import { loadExcludes } from '../../infrastructure/privacy.js';
import { readConfig } from '../../infrastructure/config.js';
import { z } from 'zod';

const recordInput = z.object({ title: z.string().min(1).max(200), body: z.string().max(20_000).optional() });
const idInput = z.object({ id: z.string().min(1).max(200) });
const renameInput = idInput.extend({ title: z.string().min(1).max(200) });
const updateRecordInput = renameInput.extend({ body: z.string().max(20_000).optional() });
const handoffInput = z.object({ content: z.string().min(1).max(18_000) });
const linkInput = z.object({ kind: z.enum(['issue', 'pr']), url: z.string().url().max(500) });
async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > 64_000) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function authorized(request: IncomingMessage, token: string): boolean {
  const received = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
  const left = Buffer.from(received);
  const right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
}
function respond(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
export async function serveApi(app: ThreadPort, cwd: string, port: number): Promise<void> {
  const token = randomBytes(32).toString('hex');
  const server = createServer((request, response) => {
    if (!authorized(request, token)) { respond(response, 401, { error: 'Unauthorized' }); return; }
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'POST' && ['/v1/notes', '/v1/tasks', '/v1/decisions', '/v1/memory'].includes(url.pathname)) {
        void (async () => {
          try {
            const input = recordInput.parse(await readJson(request));
            if (url.pathname === '/v1/decisions') { app.decide(input.title, input.body ?? ''); respond(response, 201, { ok: true }); return; }
            const kind = url.pathname === '/v1/tasks' ? 'task' : url.pathname === '/v1/memory' ? 'memory' : 'note';
            const item = app.addRecord(kind, input.title, input.body ?? '', kind === 'task' ? 'open' : 'info');
            respond(response, 201, item);
          } catch (error: unknown) { respond(response, error instanceof Error && error.message.includes('too large') ? 413 : 400, { error: error instanceof Error ? error.message : String(error) }); }
        })();
        return;
      }
      if (request.method === 'POST' && ['/v1/sessions', '/v1/sessions/open', '/v1/sessions/finish', '/v1/sessions/rename', '/v1/sessions/delete', '/v1/tasks/complete', '/v1/records/update', '/v1/records/delete'].includes(url.pathname)) {
        void (async () => {
          try {
            const input = await readJson(request);
            if (url.pathname === '/v1/sessions') {
              const { title } = recordInput.parse(input);
              respond(response, 201, app.newSession(title));
            } else if (url.pathname === '/v1/sessions/rename') {
              const { id, title } = renameInput.parse(input);
              respond(response, 200, app.rename(id, title));
            } else if (url.pathname === '/v1/records/update') {
              const { id, title, body } = updateRecordInput.parse(input);
              respond(response, 200, app.updateRecord(id, title, body));
            } else {
              const { id } = idInput.parse(input);
              if (url.pathname === '/v1/sessions/delete') { app.deleteSession(id); respond(response, 200, { ok: true }); }
              else if (url.pathname === '/v1/records/delete') { app.deleteRecord(id); respond(response, 200, { ok: true }); }
              else if (url.pathname === '/v1/sessions/finish') respond(response, 200, app.finish(id));
              else respond(response, 200, url.pathname === '/v1/sessions/open' ? app.open(id) : app.completeTask(id));
            }
          } catch (error: unknown) { respond(response, error instanceof Error && error.message.includes('too large') ? 413 : 400, { error: error instanceof Error ? error.message : String(error) }); }
        })();
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/summary') { respond(response, 201, app.summarize()); return; }
      if (request.method === 'POST' && ['/v1/handoff', '/v1/links'].includes(url.pathname)) {
        void (async () => {
          try {
            const input = await readJson(request);
            if (url.pathname === '/v1/handoff') respond(response, 201, app.saveHandoff(handoffInput.parse(input).content));
            else { const link = linkInput.parse(input); respond(response, 201, app.linkWork(link.kind, link.url)); }
          } catch (error: unknown) { respond(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
        })();
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/status') { respond(response, 200, { active: app.active() }); return; }
      if (request.method === 'GET' && url.pathname === '/v1/handoff/draft') { respond(response, 200, { content: app.handoffDraft() }); return; }
      if (request.method === 'GET' && url.pathname === '/v1/handoff') { respond(response, 200, { handoff: app.latestHandoff() }); return; }
      if (request.method === 'GET' && url.pathname === '/v1/verification') { respond(response, 200, { verification: app.verificationStatus() }); return; }
      if (request.method === 'GET' && url.pathname === '/v1/privacy/audit') { respond(response, 200, app.privacyAudit()); return; }
      if (request.method === 'GET' && url.pathname === '/v1/sessions') { respond(response, 200, { sessions: app.sessions() }); return; }
      if (request.method === 'GET' && url.pathname === '/v1/context') {
        const mode = assertMode(url.searchParams.get('mode') ?? readConfig(cwd).context.defaultMode);
        respond(response, 200, app.contextPack(mode, loadExcludes(cwd))); return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/timeline') {
        const current = app.active(); respond(response, 200, { events: current ? app.events(current.id) : [] }); return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/decisions') {
        const current = app.active(); respond(response, 200, { decisions: current ? app.decisions(current.id) : [] }); return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/records') {
        const current = app.active(); respond(response, 200, { records: current ? app.records(current.id) : [] }); return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/runs') {
        const current = app.active(); respond(response, 200, { runs: current ? app.runs(current.id) : [] }); return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/search') {
        respond(response, 200, { results: app.search(url.searchParams.get('q') ?? '') }); return;
      }
      respond(response, 404, { error: 'Not found' });
    } catch (error: unknown) { respond(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const address = server.address() as AddressInfo;
  console.log(`ThreadPort API: http://127.0.0.1:${address.port}`);
  console.log(`Bearer token: ${token}`);
  await new Promise<void>((resolve) => { server.once('close', resolve); process.once('SIGINT', () => server.close()); process.once('SIGTERM', () => server.close()); });
}
