import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Fork } from '../domain/model.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } });
}
export interface ForkStats { files: number; added: number; deleted: number; paths: string[]; }
export class GitWorktrees {
  create(root: string, fork: Fork): void {
    mkdirSync(join(root, '.threadport', 'worktrees'), { recursive: true, mode: 0o700 });
    git(root, ['worktree', 'add', '-b', fork.branch, fork.path, fork.baseHead]);
  }
  remove(root: string, fork: Fork): void { git(root, ['worktree', 'remove', fork.path]); }
  diff(fork: Fork): string {
    let output = git(fork.path, ['diff', '--no-ext-diff', fork.baseHead, '--']);
    const untracked = git(fork.path, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
    for (const path of untracked) {
      if (output.length >= 200_000) break;
      try { output += git(fork.path, ['diff', '--no-index', '--', '/dev/null', path]); }
      catch (error: unknown) {
        const result = error as { status?: number; stdout?: string | Buffer };
        if (result.status !== 1) throw error;
        output += typeof result.stdout === 'string' ? result.stdout : result.stdout?.toString('utf8') ?? '';
      }
    }
    return output.slice(0, 200_000);
  }
  stats(fork: Fork): ForkStats {
    const paths = git(fork.path, ['diff', '--name-only', '-z', fork.baseHead, '--']).split('\0').filter(Boolean);
    const short = git(fork.path, ['diff', '--shortstat', fork.baseHead, '--']);
    const added = Number(/(\d+) insertions?\(\+\)/.exec(short)?.[1] ?? 0);
    const deleted = Number(/(\d+) deletions?\(-\)/.exec(short)?.[1] ?? 0);
    const untracked = git(fork.path, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
    paths.push(...untracked);
    return { files: paths.length, added, deleted, paths };
  }
}
