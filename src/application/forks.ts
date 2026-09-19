import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Fork } from '../domain/model.js';
import type { GitReader, SessionStore } from './ports.js';

export interface WorktreePort { create(root: string, fork: Fork): void; remove(root: string, fork: Fork): void; stats(fork: Fork): { files: number; added: number; deleted: number; paths: string[] }; diff(fork: Fork): string; }
export class Forks {
  constructor(private readonly store: SessionStore, private readonly reader: GitReader, private readonly worktrees: WorktreePort, private readonly root: string) {}
  create(agents: string[]): Fork[] {
    const session = this.store.getActiveSession();
    if (!session) throw new Error('Aucune session active.');
    const state = this.reader.read(this.root);
    if (!state?.head) throw new Error('Les forks nécessitent un dépôt Git avec un commit HEAD.');
    if (state.changedFiles.length) throw new Error('Le dépôt contient des modifications. Enregistrez-les avant de créer des forks pour garantir une base identique.');
    const forks: Fork[] = [];
    for (const agentId of agents) {
      const id = randomUUID().slice(0, 8);
      const fork: Fork = { id, sessionId: session.id, agentId, branch: `threadport/${session.id}/${agentId}-${id}`, path: join(this.root, '.threadport', 'worktrees', id), baseHead: state.head, createdAt: new Date().toISOString() };
      this.worktrees.create(this.root, fork);
      this.store.addFork(fork);
      forks.push(fork);
    }
    return forks;
  }
  list(): Fork[] { const session = this.store.getActiveSession(); if (!session) throw new Error('Aucune session active.'); return this.store.listForks(session.id); }
  get(id: string): Fork { const item = this.list().find((fork) => fork.id === id); if (!item) throw new Error(`Fork introuvable : ${id}`); return item; }
  remove(id: string): void { const fork = this.get(id); this.worktrees.remove(this.root, fork); this.store.deleteFork(id); }
  diff(id: string): string { return this.worktrees.diff(this.get(id)); }
  compare(firstId: string, secondId: string) {
    const first = this.get(firstId);
    const second = this.get(secondId);
    if (first.baseHead !== second.baseHead) throw new Error('Ces forks ne partagent pas le même commit de base.');
    return [first, second].map((fork) => {
      const records = this.store.listRecords(fork.sessionId).filter((record) => record.forkId === fork.id);
      const runs = this.store.listRuns(fork.sessionId).filter((run) => run.forkId === fork.id);
      const usage = records.filter((record) => record.kind === 'usage').reduce((sum, record) => {
        try {
          const value: unknown = JSON.parse(record.body);
          if (typeof value === 'object' && value !== null && 'input_tokens' in value && 'output_tokens' in value) return sum + Number(value.input_tokens) + Number(value.output_tokens);
        } catch { /* Malformed provider event */ }
        return sum;
      }, 0);
      return {
        fork,
        stats: this.worktrees.stats(fork),
        runs,
        tests: records.filter((record) => record.kind === 'test'),
        commands: records.filter((record) => record.kind === 'command').length,
        errors: records.filter((record) => record.kind === 'error').length,
        durationMs: runs.reduce((sum, run) => sum + (run.endedAt ? Date.parse(run.endedAt) - Date.parse(run.startedAt) : 0), 0),
        tokens: usage,
      };
    });
  }
}
