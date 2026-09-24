import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { assertMode } from '../../../domain/model.js';
import { loadExcludes } from '../../../infrastructure/privacy.js';
import { readConfig } from '../../../infrastructure/config.js';
import { databaseFileName, findProjectRoot, projectDirName } from '../../../infrastructure/project.js';
import {
  contextMode,
  cwd,
  git,
  invocationDir,
  knownAgents,
  project,
  requireActive,
  runner,
  withProject,
} from '../runtime.js';

export function registerSessionCommands(cli: Command): void {
  cli
    .command('init')
    .description('Initialize ThreadPort in the current directory')
    .action(() => {
      if (existsSync(join(invocationDir, projectDirName, databaseFileName))) {
        console.log('✓ ThreadPort is already initialized here.');
        return;
      }
      const parent = findProjectRoot(invocationDir);
      const { store } = project(invocationDir, true);
      store.close();
      console.log(`✓ Project initialized: ${resolve(invocationDir, projectDirName)}`);
      if (parent) console.log(`ℹ This nested project takes precedence over ${parent} in this directory.`);
      if (!git.read(invocationDir)) console.log('ℹ No Git repository found; Git snapshots will be unavailable.');
      console.log('Next step: threadport new "Your objective"');
    });
  cli
    .command('new <objective>')
    .description('Create and activate a session')
    .action((objective: string) =>
      withProject((app) => {
        const session = app.newSession(objective);
        console.log(`✓ Session created: ${session.id} — ${session.title}`);
        const available = knownAgents().filter((agent) => runner.available(agent.command));
        console.log(
          available[0]
            ? `Next step: threadport run ${available[0].id}`
            : 'No agent CLI found. Run "threadport doctor" or use "threadport context".',
        );
      }),
    );
  cli
    .command('sessions')
    .description('List sessions')
    .action(() =>
      withProject((app) => {
        const sessions = app.sessions();
        if (!sessions.length) {
          console.log('No sessions. Run "threadport new <objective>".');
          return;
        }
        for (const item of sessions)
          console.log(
            `${item.status === 'active' ? '●' : '○'} ${item.id.padEnd(8)} ${item.status.padEnd(6)} ${item.title}`,
          );
      }),
    );
  cli
    .command('open <id>')
    .description('Activate an existing session')
    .action((id: string) =>
      withProject((app) => {
        const session = app.open(id);
        console.log(`✓ Active session: ${session.id} — ${session.title}`);
      }),
    );
  cli
    .command('finish <id>')
    .description('Mark a session as finished')
    .action((id: string) =>
      withProject((app) => {
        const session = app.finish(id);
        console.log(`✓ Session finished: ${session.id} — ${session.title}`);
      }),
    );
  cli
    .command('rename <id> <title>')
    .description('Rename a session')
    .action((id: string, title: string) =>
      withProject((app) => {
        const session = app.rename(id, title);
        console.log(`✓ Session renamed: ${session.id} — ${session.title}`);
      }),
    );
  cli
    .command('delete <id>')
    .description('Permanently delete a session and its history')
    .action((id: string) =>
      withProject((app) => {
        app.deleteSession(id);
        console.log(`✓ Session deleted: ${id}`);
      }),
    );
  cli
    .command('resume <id>')
    .description('Reactivate a session and print its context')
    .option('-m, --mode <mode>', 'Context detail level', contextMode)
    .action((id: string, options: { mode?: ReturnType<typeof assertMode> }) =>
      withProject((app) => {
        app.open(id);
        console.log(app.context(options.mode ?? readConfig(cwd).context.defaultMode, loadExcludes(cwd)));
      }),
    );
  cli
    .command('status')
    .description('Show the active session and Git state')
    .action(() =>
      withProject((app) => {
        const session = app.active();
        if (!session) {
          console.log('No active session. Run "threadport new <objective>".');
          return;
        }
        const state = git.read(cwd);
        const lastRun = app.runs(session.id).at(-1);
        console.log(`Session  ${session.id} — ${session.title}`);
        console.log(`State    ${session.status}`);
        console.log(
          `Agent    ${lastRun ? `${lastRun.agentId} (${lastRun.status})${lastRun.providerSessionId ? ` · session ${lastRun.providerSessionId}` : ''}` : 'none'}`,
        );
        console.log(
          `Git      ${state ? `${state.branch ?? '(detached)'} · ${state.changedFiles.length} changed file(s)` : 'unavailable'}`,
        );
        if (state?.warning) console.log(`         ⚠ ${state.warning}`);
        console.log(`Decisions ${app.decisions(session.id).length}`);
      }),
    );
  cli
    .command('timeline')
    .description('Show events for the active session')
    .action(() =>
      withProject((app) => {
        const events = app.events(requireActive(app).id);
        for (const event of events) console.log(`${event.createdAt}  ${event.type.padEnd(23)} ${event.message}`);
      }),
    );
  cli
    .command('snapshot')
    .description('Capture the current Git state')
    .action(() =>
      withProject((app) => {
        const snapshot = app.snapshot();
        console.log(`✓ Snapshot ${snapshot.id.slice(0, 8)}: ${snapshot.git.changedFiles.length} changed file(s).`);
      }),
    );
  cli
    .command('context')
    .description('Preview context sent to an agent')
    .option('-m, --mode <mode>', 'minimal, standard, deep, or full', contextMode)
    .option('--explain', 'Show the token budget and sources')
    .action((options: { mode?: ReturnType<typeof assertMode>; explain?: boolean }) =>
      withProject((app) => {
        const pack = app.contextPack(options.mode ?? readConfig(cwd).context.defaultMode, loadExcludes(cwd));
        console.log(pack.text);
        if (options.explain)
          console.error(
            `\n${pack.tokens}/${pack.budget} tokens · Sources: ${pack.included.map((item) => item.source).join(', ')}${pack.omitted.length ? ` · Omitted: ${pack.omitted.join(', ')}` : ''}${pack.excludedPaths.length ? ` · Excluded: ${pack.excludedPaths.join(', ')}` : ''}`,
          );
      }),
    );
}
