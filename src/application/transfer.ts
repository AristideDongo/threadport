import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SessionStore } from './ports.js';
import type { Session } from '../domain/model.js';

const sessionSchema = z.object({ id: z.string(), title: z.string(), status: z.enum(['active', 'paused', 'done']), createdAt: z.string(), updatedAt: z.string() });
const runSchema = z.object({ id: z.string(), sessionId: z.string(), agentId: z.string(), status: z.enum(['running', 'completed', 'failed', 'interrupted']), startedAt: z.string(), endedAt: z.string().nullable(), exitCode: z.number().nullable(), providerSessionId: z.string().nullable().optional() });
const eventSchema = z.object({ id: z.string(), sessionId: z.string(), type: z.string(), message: z.string(), createdAt: z.string() });
const decisionSchema = z.object({ id: z.string(), sessionId: z.string(), title: z.string(), rationale: z.string(), createdAt: z.string() });
const recordSchema = z.object({ id: z.string(), sessionId: z.string(), runId: z.string().nullable(), kind: z.enum(['note', 'task', 'error', 'command', 'test', 'summary', 'memory', 'usage', 'file', 'artifact', 'constraint']), title: z.string(), body: z.string(), status: z.enum(['open', 'done', 'failed', 'info']), createdAt: z.string() });
const snapshotSchema = z.object({ id: z.string(), sessionId: z.string(), createdAt: z.string(), git: z.object({ branch: z.string().nullable(), head: z.string().nullable(), changedFiles: z.array(z.string()), diff: z.string() }) });
const archiveSchema = z.object({ formatVersion: z.literal(1), session: sessionSchema, runs: z.array(runSchema).max(100_000), events: z.array(eventSchema).max(100_000), decisions: z.array(decisionSchema).max(100_000), records: z.array(recordSchema).max(100_000), snapshots: z.array(snapshotSchema).max(100_000) });
export type SessionArchive = z.infer<typeof archiveSchema>;

export class SessionTransfer {
  constructor(private readonly store: SessionStore) {}
  export(id: string): SessionArchive {
    const session = this.store.getSession(id);
    if (!session) throw new Error(`Session introuvable : ${id}`);
    return {
      formatVersion: 1,
      session,
      runs: this.store.listRuns(id).filter((run) => !run.forkId).map(({ ownerPid: _ownerPid, forkId: _forkId, ...run }) => run),
      events: this.store.listEvents(id),
      decisions: this.store.listDecisions(id),
      records: this.store.listRecords(id).filter((record) => !record.forkId).map(({ forkId: _forkId, ...record }) => record),
      snapshots: this.store.listSnapshots(id),
    };
  }
  import(input: unknown): Session {
    const archive = archiveSchema.parse(input);
    const id = randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    const session: Session = { ...archive.session, id, status: 'active', updatedAt: now };
    this.store.transaction(() => {
      const previous = this.store.getActiveSession();
      if (previous) this.store.updateSession({ ...previous, status: 'paused', updatedAt: now });
      this.store.createSession(session);
      const runIds = new Map<string, string>();
      for (const run of archive.runs) {
        const newId = randomUUID().slice(0, 8);
        runIds.set(run.id, newId);
        this.store.addRun({ ...run, id: newId, sessionId: id, status: run.status === 'running' ? 'interrupted' : run.status, ownerPid: null, forkId: null, providerSessionId: run.providerSessionId ?? null });
      }
      for (const event of archive.events) this.store.addEvent({ ...event, id: randomUUID(), sessionId: id });
      for (const decision of archive.decisions) this.store.addDecision({ ...decision, id: randomUUID(), sessionId: id });
      for (const record of archive.records) this.store.addRecord({ ...record, id: randomUUID().slice(0, 8), sessionId: id, runId: record.runId ? runIds.get(record.runId) ?? null : null, forkId: null });
      for (const snapshot of archive.snapshots) this.store.addSnapshot({ ...snapshot, id: randomUUID(), sessionId: id, git: { ...snapshot.git, diff: '' } });
      this.store.addEvent({ id: randomUUID(), sessionId: id, type: 'SessionImported', message: `Imported from ${archive.session.id}`, createdAt: now });
    });
    return session;
  }
}
