import { execFileSync } from 'node:child_process';
import type { GitState } from '../domain/model.js';
import type { GitReader } from '../application/ports.js';

const statusLimit = 64 * 1024 * 1024;
const diffLimit = 16 * 1024 * 1024;
function tooLarge(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === 'ENOBUFS'; }
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
      let entries: string[];
      try { entries = git(cwd, ['status', '--porcelain=v1', '-z', '-uall'], statusLimit).split('\0').filter(Boolean); }
      catch (error: unknown) {
        if (!tooLarge(error)) throw error;
        return { branch, head, changedFiles: [], diff: '', warning: 'Too many changed or untracked files to read. Add large generated folders to .gitignore.' };
      }
      const changedFiles: string[] = [];
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index] ?? '';
        const path = entry.slice(3);
        if (path && path !== '.threadport' && !path.startsWith('.threadport/')) changedFiles.push(path);
        if (/^[RC]/.test(entry.slice(0, 2)) || /[RC]$/.test(entry.slice(0, 2))) index++;
      }
      let diff = '';
      try { diff = `${git(cwd, ['diff', '--no-ext-diff', '--', '.'], diffLimit)}\n${git(cwd, ['diff', '--cached', '--no-ext-diff', '--', '.'], diffLimit)}`; }
      catch { return { branch, head, changedFiles, diff: '[Diff too large or unavailable]', warning: 'The Git diff is too large or unavailable; verification cannot be tied to it.' }; }
      return { branch, head, changedFiles, diff: diff.slice(0, 512_000) };
    } catch { return null; }
  }
}
