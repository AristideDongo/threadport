import type { Command } from 'commander';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ThreadPort } from '../../../application/threadport.js';
import { loadExcludes } from '../../../infrastructure/privacy.js';
import { readConfig } from '../../../infrastructure/config.js';
import { SqliteStore } from '../../../infrastructure/sqlite-store.js';
import { installAgentPlugin, loadAgentPlugins, trustAgentPlugin } from '../../../infrastructure/agent-plugins.js';
import { StructuredAgentRunner } from '../../../infrastructure/structured-agent.js';
import {
  findProjectRoot,
  handleLifecycleHook,
  installLifecycleHooks,
} from '../../../infrastructure/lifecycle-hooks.js';
import {
  cwd,
  dbPath,
  findAgent,
  git,
  knownAgents,
  projectDir,
  requireActive,
  runner,
  withProjectAsync,
} from '../runtime.js';

async function launch(agentId: string, options: { structured?: boolean }): Promise<void> {
  await withProjectAsync(async (app) => launchIn(app, agentId, options.structured === true));
}
export async function launchIn(
  app: ThreadPort,
  agentId: string,
  structured = false,
  providerSessionId: string | null = null,
): Promise<void> {
  const adapter = findAgent(agentId);
  requireActive(app);
  if (!runner.available(adapter.command)) {
    const guide =
      agentId === 'claude'
        ? ' Install Claude Code: https://code.claude.com/docs/en/setup'
        : agentId === 'codex'
          ? ' Install Codex CLI: https://developers.openai.com/codex/cli/'
          : '';
    throw new Error(`${adapter.label} was not found (${adapter.command}). Run "threadport doctor".${guide}`);
  }
  const tempDir = mkdtempSync(join(tmpdir(), 'threadport-'));
  const file = join(tempDir, 'handoff.md');
  try {
    writeFileSync(file, app.context(readConfig(cwd).context.defaultMode, loadExcludes(cwd)), { mode: 0o600 });
    console.log(`→ Launching ${adapter.label} with active session context.`);
    const activeAdapter = providerSessionId
      ? {
          ...adapter,
          args: (contextFile: string) => {
            if (!adapter.resumeArgs) throw new Error(`Native resumption is unavailable for ${agentId}.`);
            return adapter.resumeArgs(providerSessionId, contextFile);
          },
        }
      : structured
        ? {
            ...adapter,
            args: (contextFile: string) => {
              if (!adapter.structuredArgs) throw new Error(`Structured mode is unavailable for ${agentId}.`);
              return adapter.structuredArgs(contextFile);
            },
          }
        : adapter;
    const activeRunner = structured
      ? new StructuredAgentRunner(agentId, (event) => {
          if (event.kind === 'session') app.linkProviderSession(event.body);
          const kind =
            event.kind === 'error'
              ? 'error'
              : event.kind === 'command'
                ? 'command'
                : event.kind === 'usage'
                  ? 'usage'
                  : 'note';
          app.addRunRecord(kind, event.title || 'Agent event', event.body, event.kind === 'error' ? 'open' : 'info');
          if (
            event.kind === 'command' &&
            event.exitCode !== undefined &&
            /(?:^|\s)(?:test|pytest|vitest|jest)(?:\s|$)/i.test(event.title)
          )
            app.addRunRecord('test', event.title, event.body, event.exitCode === 0 ? 'done' : 'failed');
          if (event.kind === 'message') console.log(event.body);
        })
      : runner;
    const run = await app.run(activeAdapter, activeRunner, file, providerSessionId);
    console.log(`\n✓ Run ${run.id} finished (${run.status}, exit code ${run.exitCode}).`);
    if (run.status === 'failed' && agentId === 'claude')
      console.error(
        'If Claude asked you to trust this folder and you declined, review the folder and rerun the command.',
      );
    if (run.exitCode !== 0) process.exitCode = run.exitCode ?? 1;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function registerAgentCommands(cli: Command): void {
  cli
    .command('agents')
    .description('List configured agents')
    .action(() => {
      for (const agent of knownAgents())
        console.log(
          `${runner.available(agent.command) ? '✓' : '·'} ${agent.id.padEnd(8)} ${agent.label} (${agent.command})${'trusted' in agent && !agent.trusted ? ' · untrusted' : ''}`,
        );
    });
  const plugin = cli.command('plugin').description('Manage local agent adapters');
  plugin
    .command('add <manifest>')
    .description('Install an agent JSON manifest in the project')
    .action((path: string) => {
      const value = installAgentPlugin(projectDir, path);
      console.log(`✓ Agent ${value.id} installed.`);
    });
  plugin
    .command('list')
    .description('List project agent adapters')
    .action(() => {
      for (const item of loadAgentPlugins(projectDir))
        console.log(`${item.id} ${item.command}${item.trusted ? '' : ' (untrusted)'}`);
    });
  plugin
    .command('trust <id>')
    .description('Allow a reviewed project agent manifest to run')
    .action((id: string) => {
      const item = trustAgentPlugin(projectDir, id);
      console.log(`✓ Agent ${item.id} trusted: ${item.command} (${item.manifestPath})`);
    });
  cli
    .command('run <agent>')
    .description('Launch an agent with active session context')
    .option('--structured', 'Capture provider JSON events')
    .action(launch);
  cli
    .command('switch <agent>')
    .description('Hand off to another agent')
    .option('--structured', 'Capture provider JSON events')
    .action(launch);
  cli
    .command('continue <agent>')
    .description('Resume a linked native provider session')
    .action(async (agentId: string) =>
      withProjectAsync(async (app) => {
        const session = requireActive(app);
        const previous = app
          .runs(session.id)
          .findLast((run) => run.agentId === agentId && Boolean(run.providerSessionId));
        if (!previous?.providerSessionId)
          throw new Error(`No linked ${agentId} session. First run "threadport run ${agentId} --structured".`);
        await launchIn(app, agentId, false, previous.providerSessionId);
      }),
    );

  const hook = cli.command('hook').description('Install and receive optional agent lifecycle hooks');
  hook
    .command('install <agent>')
    .description('Install local Claude or Codex hooks in this project')
    .action((agent: string) => {
      if (agent !== 'claude' && agent !== 'codex') throw new Error('Choose claude or codex.');
      if (!existsSync(dbPath)) throw new Error('Initialize the project first with "threadport init".');
      console.log(`✓ Hooks installed: ${installLifecycleHooks(cwd, agent)}`);
      if (agent === 'codex') console.log('Review and trust the new project hooks with /hooks in Codex.');
    });
  hook
    .command('ingest <agent>')
    .description('Receive a lifecycle event from an agent')
    .action(async (agent: string) => {
      if (agent !== 'claude' && agent !== 'codex') return;
      const root = findProjectRoot(cwd);
      if (!root) return;
      let input = '';
      for await (const chunk of process.stdin) {
        input += String(chunk);
        if (input.length > 128_000) return;
      }
      let value: unknown;
      try {
        value = JSON.parse(input) as unknown;
      } catch {
        return;
      }
      const store = new SqliteStore(join(root, '.threadport', 'threadport.sqlite'));
      try {
        const app = new ThreadPort(store, git, root, loadExcludes(root));
        const output = handleLifecycleHook(app, root, agent, value);
        if (output) process.stdout.write(`${output}\n`);
      } finally {
        store.close();
      }
    });
}
