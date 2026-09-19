import { execFileSync } from 'node:child_process';
import type { GitState } from '../domain/model.js';
import type { GitReader } from '../application/ports.js';

function git(cwd: string, args: string[], maxBuffer = 1024 * 1024): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer }).trimEnd();
}

export class GitCliReader implements GitReader {
  read(cwd: string): GitState | null {
    try {
      git(cwd, ['rev-parse', '--show-toplevel']);
      const branch = git(cwd, ['branch', '--show-current']) || null;
      let head: string | null = null;
      try { head = git(cwd, ['rev-parse', 'HEAD']); } catch { /* unborn branch */ }
      const lines = git(cwd, ['status', '--porcelain=v1', '-uall']).split('\n').filter(Boolean);
      const changedFiles = lines.map((line) => line.slice(3).split(' -> ').at(-1) ?? '').filter((file) => Boolean(file) && file !== '.threadport' && !file.startsWith('.threadport/'));
      let diff = '';
      try { diff = git(cwd, ['diff', '--no-ext-diff', '--', '.']) + '\n' + git(cwd, ['diff', '--cached', '--no-ext-diff', '--', '.']); }
      catch { diff = '[Diff trop volumineux ou indisponible]'; }
      return { branch, head, changedFiles, diff: diff.slice(0, 512_000) };
    } catch { return null; }
  }
}
