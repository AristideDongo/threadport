import type { Command } from 'commander';
import { redact, safeDiff } from '../../../application/context.js';
import { ThreadPort } from '../../../application/threadport.js';
import { Forks } from '../../../application/forks.js';
import { loadExcludes } from '../../../infrastructure/privacy.js';
import { LocalCommandExecutor } from '../../../infrastructure/command-executor.js';
import { launchIn } from './agents.js';
import { cwd, findAgent, git, project, worktrees } from '../runtime.js';

export function registerForkCommands(cli: Command): void {
  const forkCommand = cli.command('fork').description('Experiment in isolated Git worktrees');
  forkCommand.option('--agents <ids>', 'Comma-separated agent IDs').action((options: { agents?: string }) => {
    if (!options.agents) { forkCommand.help(); return; }
    const agents = options.agents.split(',').map((id) => id.trim()).filter(Boolean);
    if (!agents.length) throw new Error('Specify at least one agent.');
    for (const id of agents) findAgent(id);
    const { store } = project();
    try {
      const forks = new Forks(store, git, worktrees, cwd).create(agents);
      for (const item of forks) console.log(`✓ ${item.id} ${item.agentId} → ${item.path}`);
    } finally { store.close(); }
  });
  forkCommand.command('list').description('List session forks').action(() => {
    const { store } = project();
    try { for (const item of new Forks(store, git, worktrees, cwd).list()) console.log(`${item.id} ${item.agentId.padEnd(8)} ${item.branch} ${item.path}`); }
    finally { store.close(); }
  });
  forkCommand.command('remove <id>').description('Remove a clean worktree and keep its branch').action((id: string) => {
    const { store } = project();
    try { new Forks(store, git, worktrees, cwd).remove(id); console.log(`✓ Worktree ${id} removed; branch kept.`); }
    finally { store.close(); }
  });
  forkCommand.command('run <id>').description('Launch the assigned agent in its worktree').option('--structured', 'Capture provider JSON events').action(async (id: string, options: { structured?: boolean }) => {
    const { store } = project();
    try {
      const fork = new Forks(store, git, worktrees, cwd).get(id);
      await launchIn(new ThreadPort(store, git, fork.path, loadExcludes(cwd)), fork.agentId, options.structured === true);
    } finally { store.close(); }
  });
  forkCommand.command('check <id> <executable> [args...]').description('Run a command in a fork and record its result').action(async (id: string, executable: string, args: string[]) => {
    const { store } = project();
    try {
      const fork = new Forks(store, git, worktrees, cwd).get(id);
      const code = await new ThreadPort(store, git, fork.path, loadExcludes(cwd)).check(executable, args, new LocalCommandExecutor());
      if (code !== 0) process.exitCode = code;
    } finally { store.close(); }
  });
  cli.command('compare <first> <second>').description('Compare changes between two forks').option('--diff', 'Show full diffs (size limited)').action((first: string, second: string, options: { diff?: boolean }) => {
    const { store } = project();
    try {
      const forks = new Forks(store, git, worktrees, cwd);
      const comparison = forks.compare(first, second);
      for (const item of comparison) console.log(`${item.fork.id} (${item.fork.agentId})\n  ${item.stats.files} files · +${item.stats.added} / -${item.stats.deleted} lines\n  ${item.runs.length} run(s) · ${item.commands} command(s) · ${item.errors} error(s) · ${Math.round(item.durationMs / 1000)} s\n  ${item.tests.filter((test) => test.status === 'done').length} passed test(s) · ${item.tests.filter((test) => test.status === 'failed').length} failed test(s) · ${item.tokens || 'n/a'} recorded tokens\n  ${item.stats.paths.join(', ') || 'no changes'}`);
      if (options.diff) for (const item of comparison) console.log(`\n--- ${item.fork.id} ---\n${redact(safeDiff(forks.diff(item.fork.id), loadExcludes(cwd)))}`);
    } finally { store.close(); }
  });
}
