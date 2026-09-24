import type { Command } from 'commander';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SessionTransfer } from '../../../application/transfer.js';
import { loadExcludes } from '../../../infrastructure/privacy.js';
import { verificationCommands } from '../../../infrastructure/config.js';
import { LocalCommandExecutor } from '../../../infrastructure/command-executor.js';
import { cwd, project, withProject, withProjectAsync } from '../runtime.js';

export function registerContinuityCommands(cli: Command): void {
  const handoff = cli.command('handoff').description('Draft and review a cross-agent handoff');
  handoff.command('draft').description('Show a sourced handoff draft').option('-o, --out <file>', 'Write a new Markdown file for review').action((options: { out?: string }) => withProject((app) => {
    const draft = app.handoffDraft();
    if (options.out) { writeFileSync(options.out, `${draft}\n`, { mode: 0o600, flag: 'wx' }); console.log(`✓ Handoff draft: ${resolve(options.out)}`); }
    else console.log(draft);
  }));
  handoff.command('save <file>').description('Save a Markdown handoff from a file').action((file: string) => withProject((app) => {
    if (statSync(file).size > 18_000) throw new Error('Handoff file is too large (18 KB maximum).');
    const item = app.saveHandoff(readFileSync(file, 'utf8'));
    console.log(`✓ Handoff saved: ${item.id}`);
  }));
  handoff.command('show').description('Show the latest saved handoff').action(() => withProject((app) => {
    const saved = app.latestHandoff();
    if (!saved) throw new Error('No saved handoff. Run "threadport handoff draft" first.');
    if (saved.stale) console.error('⚠ Handoff may be stale; review the current files.');
    console.log(saved.content);
  }));
  const link = cli.command('link').description('Associate the active session with GitHub work');
  link.command('issue <url>').description('Link a GitHub issue').action((url: string) => withProject((app) => console.log(`✓ Linked ${app.linkWork('issue', url).title}`)));
  link.command('pr <url>').description('Link a GitHub pull request').action((url: string) => withProject((app) => console.log(`✓ Linked ${app.linkWork('pr', url).title}`)));
  cli.command('verify [executable] [args...]').description('Run configured checks, or one supplied command, and bind results to Git state').action(async (executable: string | undefined, args: string[], _options: unknown) => withProjectAsync(async (app) => {
    const commands = executable ? [{ command: executable, args }] : verificationCommands(cwd);
    if (!commands.length) throw new Error('No verification commands. Add verification.commands to .threadport/config.json or pass an executable.');
    const report = await app.verify(commands, new LocalCommandExecutor());
    for (const result of report.results) console.log(`${result.exitCode === 0 ? '✓' : '✗'} ${[result.command, ...result.args].join(' ')} (exit ${result.exitCode}, ${result.durationMs} ms)`);
    console.log(report.passed ? '✓ Verification passed on the current Git state.' : report.unchanged ? '✗ Verification failed.' : '⚠ Verification cannot be tied to the current Git state.');
    if (!report.passed) process.exitCode = 1;
  }));
  cli.command('search <query>').description('Search sessions, decisions, and records').action((query: string) => withProject((app) => {
    const hits = app.search(query);
    if (!hits.length) { console.log('No results.'); return; }
    for (const hit of hits) console.log(`${hit.source.padEnd(8)} ${hit.sessionId} ${hit.title}\n  ${hit.snippet}`);
  }));
  cli.command('export <id>').description('Export a session as portable JSON').requiredOption('-o, --out <file>', 'Destination file').action((id: string, options: { out: string }) => {
    const { store } = project();
    try {
      const archive = new SessionTransfer(store, loadExcludes(cwd)).export(id);
      writeFileSync(options.out, `${JSON.stringify(archive, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      console.log(`✓ Session ${id} exported: ${resolve(options.out)}`);
    } finally { store.close(); }
  });
  cli.command('import <file>').description('Import a JSON session archive').action((file: string) => {
    if (statSync(file).size > 10_000_000) throw new Error('Archive is too large (10 MB maximum).');
    const input: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const { store } = project();
    try {
      const session = new SessionTransfer(store, loadExcludes(cwd)).import(input);
      console.log(`✓ Session imported: ${session.id} — ${session.title}`);
    } finally { store.close(); }
  });
}
