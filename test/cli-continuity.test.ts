import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const loader = import.meta.resolve('tsx');
const cli = join(process.cwd(), 'src', 'interfaces', 'cli', 'main.ts');

it('uses the installed CLI workflow for verification, linked work, review, and privacy audit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'threadport-cli-continuity-'));
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    git('init', '-q'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test');
    writeFileSync(join(dir, '.gitignore'), '.threadport/\n');
    writeFileSync(join(dir, 'app.txt'), 'base\n');
    git('add', '.'); git('commit', '-qm', 'base');
    const run = (...args: string[]) => {
      const result = spawnSync(process.execPath, ['--import', loader, cli, ...args], { cwd: dir, encoding: 'utf8', timeout: 20_000 });
      if (result.status !== 0) throw new Error(`${args.join(' ')}: ${result.stderr || result.stdout}`);
      return result.stdout;
    };
    run('init');
    run('new', 'Check a real workflow');
    run('link', 'issue', 'https://github.com/example/repo/issues/42');
    expect(run('verify', 'git', 'status')).toContain('Verification passed');
    expect(run('handoff', 'draft', '--out', join(dir, '.threadport', 'handoff.md'))).toContain('Handoff draft');
    run('handoff', 'save', join(dir, '.threadport', 'handoff.md'));
    expect(run('handoff', 'show')).toContain('Issue #42');
    expect(run('privacy', 'audit')).toContain('Excluded references: 0');
    writeFileSync(join(dir, 'app.txt'), 'changed\n');
    const stale = spawnSync(process.execPath, ['--import', loader, cli, 'handoff', 'show'], { cwd: dir, encoding: 'utf8' });
    expect(stale.stderr).toContain('stale');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 60_000);
