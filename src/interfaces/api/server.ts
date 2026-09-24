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
class PayloadTooLarge extends Error {}
async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > 64_000) throw new PayloadTooLarge('Request body is too large.');
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

type Reply = readonly [status: number, body: unknown];
/** Handlers receive the parsed JSON body for POST routes and the request URL for query parameters. */
type Handler = (body: unknown, url: URL) => Reply;

function routes(app: ThreadPort, cwd: string): Map<string, Handler> {
  const ok = { ok: true };
  const active = <T>(read: (id: string) => T[]): T[] => {
    const current = app.active();
    return current ? read(current.id) : [];
  };
  const record =
    (kind: 'note' | 'task' | 'memory'): Handler =>
    (body) => {
      const input = recordInput.parse(body);
      return [201, app.addRecord(kind, input.title, input.body ?? '', kind === 'task' ? 'open' : 'info')];
    };
  return new Map<string, Handler>([
    ['POST /v1/notes', record('note')],
    ['POST /v1/tasks', record('task')],
    ['POST /v1/memory', record('memory')],
    [
      'POST /v1/decisions',
      (body) => {
        const input = recordInput.parse(body);
        app.decide(input.title, input.body ?? '');
        return [201, ok];
      },
    ],
    ['POST /v1/sessions', (body) => [201, app.newSession(recordInput.parse(body).title)]],
    ['POST /v1/sessions/open', (body) => [200, app.open(idInput.parse(body).id)]],
    ['POST /v1/sessions/finish', (body) => [200, app.finish(idInput.parse(body).id)]],
    [
      'POST /v1/sessions/rename',
      (body) => {
        const { id, title } = renameInput.parse(body);
        return [200, app.rename(id, title)];
      },
    ],
    [
      'POST /v1/sessions/delete',
      (body) => {
        app.deleteSession(idInput.parse(body).id);
        return [200, ok];
      },
    ],
    ['POST /v1/tasks/complete', (body) => [200, app.completeTask(idInput.parse(body).id)]],
    [
      'POST /v1/records/update',
      (body) => {
        const { id, title, body: details } = updateRecordInput.parse(body);
        return [200, app.updateRecord(id, title, details)];
      },
    ],
    [
      'POST /v1/records/delete',
      (body) => {
        app.deleteRecord(idInput.parse(body).id);
        return [200, ok];
      },
    ],
    ['POST /v1/summary', () => [201, app.summarize()]],
    ['POST /v1/handoff', (body) => [201, app.saveHandoff(handoffInput.parse(body).content)]],
    [
      'POST /v1/links',
      (body) => {
        const link = linkInput.parse(body);
        return [201, app.linkWork(link.kind, link.url)];
      },
    ],
    ['GET /v1/status', () => [200, { active: app.active() }]],
    ['GET /v1/handoff/draft', () => [200, { content: app.handoffDraft() }]],
    ['GET /v1/handoff', () => [200, { handoff: app.latestHandoff() }]],
    ['GET /v1/verification', () => [200, { verification: app.verificationStatus() }]],
    ['GET /v1/privacy/audit', () => [200, app.privacyAudit()]],
    ['GET /v1/sessions', () => [200, { sessions: app.sessions() }]],
    [
      'GET /v1/context',
      (_body, url) => [
        200,
        app.contextPack(
          assertMode(url.searchParams.get('mode') ?? readConfig(cwd).context.defaultMode),
          loadExcludes(cwd),
        ),
      ],
    ],
    ['GET /v1/timeline', () => [200, { events: active((id) => app.events(id)) }]],
    ['GET /v1/decisions', () => [200, { decisions: active((id) => app.decisions(id)) }]],
    ['GET /v1/records', () => [200, { records: active((id) => app.records(id)) }]],
    ['GET /v1/runs', () => [200, { runs: active((id) => app.runs(id)) }]],
    ['GET /v1/search', (_body, url) => [200, { results: app.search(url.searchParams.get('q') ?? '') }]],
  ]);
}

async function handle(request: IncomingMessage, response: ServerResponse, table: Map<string, Handler>): Promise<void> {
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const handler = table.get(`${request.method ?? ''} ${url.pathname}`);
    if (!handler) {
      respond(response, 404, { error: 'Not found' });
      return;
    }
    // POST /v1/summary takes no body; every other POST route expects JSON.
    const body = request.method === 'POST' && url.pathname !== '/v1/summary' ? await readJson(request) : undefined;
    const [status, payload] = handler(body, url);
    respond(response, status, payload);
  } catch (error: unknown) {
    respond(response, error instanceof PayloadTooLarge ? 413 : 400, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function serveApi(app: ThreadPort, cwd: string, port: number): Promise<void> {
  const token = randomBytes(32).toString('hex');
  const table = routes(app, cwd);
  const server = createServer((request, response) => {
    if (!authorized(request, token)) {
      respond(response, 401, { error: 'Unauthorized' });
      return;
    }
    void handle(request, response, table);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  console.log(`ThreadPort API: http://127.0.0.1:${address.port}`);
  console.log(`Bearer token: ${token}`);
  await new Promise<void>((resolve) => {
    server.once('close', resolve);
    process.once('SIGINT', () => server.close());
    process.once('SIGTERM', () => server.close());
  });
}
