import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { GitState } from '../src/domain/model.js';
import { firstLocatedPath, terminalInvocation } from '../apps/vscode-extension/src/support/agent-command.js';
import { CachingGitReader } from '../apps/vscode-extension/src/support/caching-git-reader.js';
import { resolveContextMode } from '../apps/vscode-extension/src/support/context-mode.js';
import { debounce } from '../apps/vscode-extension/src/support/debounce.js';

const extension = join(process.cwd(), 'apps', 'vscode-extension');

describe('context mode resolution', () => {
  it('uses the project default unless the setting is explicitly set', () => {
    expect(resolveContextMode(undefined, 'deep')).toBe('deep');
    expect(resolveContextMode({}, 'deep')).toBe('deep');
    expect(resolveContextMode({ globalValue: 'minimal' }, 'deep')).toBe('minimal');
    expect(resolveContextMode({ globalValue: 'minimal', workspaceValue: 'full' }, 'deep')).toBe('full');
    expect(resolveContextMode({ workspaceValue: 'full', workspaceFolderValue: 'standard' }, 'deep')).toBe('standard');
    expect(resolveContextMode({ globalValue: 'bogus' }, 'deep')).toBe('deep');
  });
});

describe('agent terminal invocation', () => {
  it('starts commands directly outside Windows', () => {
    expect(terminalInvocation('linux', 'claude', '/usr/bin/claude', ['prompt'])).toEqual({
      shellPath: 'claude',
      shellArgs: ['prompt'],
    });
  });

  it('runs Windows .cmd shims through cmd.exe and executables directly', () => {
    expect(terminalInvocation('win32', 'codex', 'C:\\npm\\codex.cmd', ['exec', 'go'], 'C:\\Windows\\cmd.exe')).toEqual({
      shellPath: 'C:\\Windows\\cmd.exe',
      shellArgs: ['/d', '/c', 'C:\\npm\\codex.cmd', 'exec', 'go'],
    });
    expect(terminalInvocation('win32', 'claude', 'C:\\bin\\claude.exe', ['go'])).toEqual({
      shellPath: 'C:\\bin\\claude.exe',
      shellArgs: ['go'],
    });
  });

  it('reads the first path printed by where or which', () => {
    expect(firstLocatedPath('C:\\npm\\codex\r\nC:\\npm\\codex.cmd\r\n')).toBe('C:\\npm\\codex');
    expect(firstLocatedPath('\n')).toBeNull();
  });
});

describe('caching Git reader', () => {
  it('reuses a result within its TTL and after invalidation reads again', () => {
    let now = 0;
    const state: GitState = { branch: 'main', head: 'abc', changedFiles: [], diff: '' };
    const read = vi.fn(() => state);
    const git = new CachingGitReader({ read }, 1_000, () => now);
    git.read('/repo');
    git.read('/repo');
    expect(read).toHaveBeenCalledTimes(1);
    now = 1_500;
    git.read('/repo');
    expect(read).toHaveBeenCalledTimes(2);
    git.invalidate();
    git.read('/repo');
    expect(read).toHaveBeenCalledTimes(3);
  });
});

describe('debounce', () => {
  it('runs once after a burst of calls', () => {
    vi.useFakeTimers();
    try {
      const work = vi.fn();
      const run = debounce(work, 300);
      run();
      run();
      vi.advanceTimersByTime(299);
      run();
      vi.advanceTimersByTime(300);
      expect(work).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('localization', () => {
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
    });

  it('translates every runtime string into French', () => {
    const french = JSON.parse(readFileSync(join(extension, 'l10n', 'bundle.l10n.fr.json'), 'utf8')) as Record<
      string,
      string
    >;
    const keys = sources(join(extension, 'src')).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/l10n\.t\(\s*'((?:[^'\\]|\\.)*)'/g)].map((match) =>
        (match[1] ?? '').replace(/\\'/g, "'"),
      ),
    );
    expect(keys.length).toBeGreaterThan(50);
    expect(keys.filter((key) => !(key in french))).toEqual([]);
  });

  it('defines every manifest placeholder in English and French', () => {
    const manifest = readFileSync(join(extension, 'package.json'), 'utf8');
    const placeholders = [...manifest.matchAll(/"%([^%"]+)%"/g)].map((match) => match[1] ?? '');
    for (const file of ['package.nls.json', 'package.nls.fr.json']) {
      const values = JSON.parse(readFileSync(join(extension, file), 'utf8')) as Record<string, string>;
      expect(
        placeholders.filter((key) => !(key in values)),
        file,
      ).toEqual([]);
    }
  });
});
