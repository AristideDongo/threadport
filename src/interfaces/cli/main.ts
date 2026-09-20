#!/usr/bin/env node
import { Command, InvalidArgumentError } from 'commander';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertMode } from '../../domain/model.js';
import { redact, safeDiff } from '../../application/context.js';
import { ThreadPort } from '../../application/threadport.js';
import { SessionTransfer } from '../../application/transfer.js';
import { loadExcludes } from '../../infrastructure/privacy.js';
import { readConfig, setDefaultMode } from '../../infrastructure/config.js';
import { SqliteStore } from '../../infrastructure/sqlite-store.js';
import { GitCliReader } from '../../infrastructure/git.js';
import { GitWorktrees } from '../../infrastructure/git-worktrees.js';
import { Forks } from '../../application/forks.js';
import { LocalCommandExecutor } from '../../infrastructure/command-executor.js';
import { adapterById, adapters, TerminalAgentRunner } from '../../infrastructure/agents.js';
import { installAgentPlugin, loadAgentPlugins } from '../../infrastructure/agent-plugins.js';
import { openMenu } from '../tui/menu.js';
import { serveApi } from '../api/server.js';
import { serveMcp } from '../mcp/server.js';
import { StructuredAgentRunner } from '../../infrastructure/structured-agent.js';
import { packageVersion } from '../../infrastructure/package-info.js';

const cwd = process.cwd();
const projectDir = join(cwd, '.threadport');
const dbPath = join(projectDir, 'threadport.sqlite');
const git = new GitCliReader();
const runner = new TerminalAgentRunner();
const worktrees = new GitWorktrees();
const knownAgents = () => [...adapters, ...loadAgentPlugins(projectDir)];
const findAgent = (id: string) => adapterById(id, loadAgentPlugins(projectDir));

function project(create = false): { app: ThreadPort; store: SqliteStore } {
  if (!create && !existsSync(dbPath)) throw new Error('Project is not initialized. Run "threadport init".');
  if (create) mkdirSync(projectDir, { recursive: true, mode: 0o700 });
  const store = new SqliteStore(dbPath);
  const app = new ThreadPort(store, git, cwd);
  const recovered = app.recover();
  if (recovered) console.error(`↺ Recovered ${recovered} interrupted run(s).`);
  return { app, store };
}

function withProject(action: (app: ThreadPort) => void, create = false): void {
  const { app, store } = project(create);
  try { action(app); } finally { store.close(); }
}

async function withProjectAsync(action: (app: ThreadPort) => Promise<void>): Promise<void> {
  const { app, store } = project();
  try { await action(app); } finally { store.close(); }
}

function requireActive(app: ThreadPort) {
  const session = app.active();
  if (!session) throw new Error('No active session. Run "threadport new <objective>".');
  return session;
}

function contextMode(value: string) {
  try { return assertMode(value); } catch (error: unknown) { throw new InvalidArgumentError(error instanceof Error ? error.message : String(error)); }
}

const cli = new Command();
cli.name('threadport').description('Keep development sessions consistent across AI agents.').version(packageVersion).showHelpAfterError();

cli.command('init').description('Initialize ThreadPort in the current directory').action(() => {
  if (existsSync(dbPath)) { console.log('✓ ThreadPort is already initialized here.'); return; }
  withProject(() => {
    console.log(`✓ Project initialized: ${resolve(projectDir)}`);
    if (!git.read(cwd)) console.log('ℹ No Git repository found; Git snapshots will be unavailable.');
    console.log('Next step: threadport new "Your objective"');
  }, true);
});
cli.command('new <objective>').description('Create and activate a session').action((objective: string) => withProject((app) => {
  const session = app.newSession(objective);
  console.log(`✓ Session created: ${session.id} — ${session.title}`);
  console.log('Next step: threadport run claude');
}));
cli.command('sessions').description('List sessions').action(() => withProject((app) => {
  const sessions = app.sessions();
  if (!sessions.length) { console.log('No sessions. Run "threadport new <objective>".'); return; }
  for (const item of sessions) console.log(`${item.status === 'active' ? '●' : '○'} ${item.id.padEnd(8)} ${item.status.padEnd(6)} ${item.title}`);
}));
cli.command('open <id>').description('Activate an existing session').action((id: string) => withProject((app) => {
  const session = app.open(id);
  console.log(`✓ Active session: ${session.id} — ${session.title}`);
}));
cli.command('resume <id>').description('Reactivate a session and print its context').option('-m, --mode <mode>', 'Context detail level', contextMode).action((id: string, options: { mode?: ReturnType<typeof assertMode> }) => withProject((app) => {
  app.open(id);
  console.log(app.context(options.mode ?? readConfig(cwd).context.defaultMode, loadExcludes(cwd)));
}));
cli.command('status').description('Show the active session and Git state').action(() => withProject((app) => {
  const session = app.active();
  if (!session) { console.log('No active session. Run "threadport new <objective>".'); return; }
  const state = git.read(cwd);
  const lastRun = app.runs(session.id).at(-1);
  console.log(`Session  ${session.id} — ${session.title}`);
  console.log(`State    ${session.status}`);
  console.log(`Agent    ${lastRun ? `${lastRun.agentId} (${lastRun.status})${lastRun.providerSessionId ? ` · session ${lastRun.providerSessionId}` : ''}` : 'none'}`);
  console.log(`Git      ${state ? `${state.branch ?? '(detached)'} · ${state.changedFiles.length} changed file(s)` : 'unavailable'}`);
  console.log(`Decisions ${app.decisions(session.id).length}`);
}));
cli.command('timeline').description('Show events for the active session').action(() => withProject((app) => {
  const events = app.events(requireActive(app).id);
  for (const event of events) console.log(`${event.createdAt}  ${event.type.padEnd(23)} ${event.message}`);
}));
cli.command('decision <title>').description('Record a technical decision').option('-r, --rationale <text>', 'Reason for the decision', '').action((title: string, options: { rationale: string }) => withProject((app) => {
  app.decide(title, options.rationale);
  console.log('✓ Decision recorded.');
}));
cli.command('decisions').description('List decisions').action(() => withProject((app) => {
  for (const item of app.decisions(requireActive(app).id)) console.log(`• ${item.title}${item.rationale ? ` — ${item.rationale}` : ''}`);
}));
cli.command('note <text>').description('Record a work note').action((value: string) => withProject((app) => {
  const item = app.addRecord('note', value);
  console.log(`✓ Note ${item.id} recorded.`);
}));
const task = cli.command('task').description('Manage session tasks');
task.command('add <title>').description('Add an open task').action((title: string) => withProject((app) => {
  const item = app.addRecord('task', title, '', 'open');
  console.log(`✓ Task ${item.id} added.`);
}));
task.command('done <id>').description('Mark a task as completed').action((id: string) => withProject((app) => {
  const item = app.completeTask(id);
  console.log(`✓ Task completed: ${item.title}`);
}));
task.command('list').description('List tasks').action(() => withProject((app) => {
  for (const item of app.records(requireActive(app).id).filter((entry) => entry.kind === 'task')) console.log(`${item.status === 'done' ? '✓' : '○'} ${item.id} ${item.title}`);
}));
cli.command('error <title>').description('Record an error').option('-d, --details <text>', 'Details', '').action((title: string, options: { details: string }) => withProject((app) => {
  const item = app.addRecord('error', title, options.details, 'open');
  console.log(`✓ Error ${item.id} recorded.`);
}));
cli.command('test-result <title>').description('Record a test result').requiredOption('-s, --status <status>', 'passed or failed').option('-d, --details <text>', 'Details', '').action((title: string, options: { status: string; details: string }) => withProject((app) => {
  if (options.status !== 'passed' && options.status !== 'failed') throw new Error('Status must be passed or failed.');
  const item = app.addRecord('test', title, options.details, options.status === 'passed' ? 'done' : 'failed');
  console.log(`✓ Test result ${item.id} recorded.`);
}));
cli.command('check <executable> [args...]').description('Run a command and record its result').action(async (executable: string, args: string[]) => withProjectAsync(async (app) => {
  const code = await app.check(executable, args, new LocalCommandExecutor());
  if (code !== 0) process.exitCode = code;
}));
cli.command('command-log <command>').description('Record a command run elsewhere').option('-d, --details <text>', 'Result', '').action((value: string, options: { details: string }) => withProject((app) => {
  const item = app.addRecord('command', value, options.details);
  console.log(`✓ Command ${item.id} recorded.`);
}));
cli.command('memory <text>').description('Add durable project knowledge').action((value: string) => withProject((app) => {
  const item = app.addRecord('memory', value);
  console.log(`✓ Memory ${item.id} recorded.`);
}));
cli.command('constraint <text>').description('Record a session constraint').action((value: string) => withProject((app) => {
  const item = app.addRecord('constraint', value);
  console.log(`✓ Constraint ${item.id} recorded.`);
}));
cli.command('file <path>').description('Mark a relevant file').option('-d, --details <text>', 'Reason', '').action((path: string, options: { details: string }) => withProject((app) => {
  const item = app.addRecord('file', path, options.details);
  console.log(`✓ File ${item.id} recorded.`);
}));
cli.command('files').description('List relevant and changed files').action(() => withProject((app) => {
  const session = requireActive(app);
  const marked = app.records(session.id).filter((item) => item.kind === 'file');
  const changed = git.read(cwd)?.changedFiles ?? [];
  for (const item of marked) console.log(`• ${item.title}${item.body ? ` — ${item.body}` : ''}`);
  for (const path of changed) if (!marked.some((item) => item.title === path)) console.log(`~ ${path}`);
}));
cli.command('artifact <path>').description('Record a work artifact').option('-d, --details <text>', 'Description', '').action((path: string, options: { details: string }) => withProject((app) => {
  const item = app.addRecord('artifact', path, options.details);
  console.log(`✓ Artifact ${item.id} recorded.`);
}));
cli.command('summary').description('Summarize the active session').action(() => withProject((app) => {
  const item = app.summarize();
  console.log(`${item.title}\n${item.body}`);
}));
cli.command('search <query>').description('Search sessions, decisions, and records').action((query: string) => withProject((app) => {
  const hits = app.search(query);
  if (!hits.length) { console.log('No results.'); return; }
  for (const hit of hits) console.log(`${hit.source.padEnd(8)} ${hit.sessionId} ${hit.title}\n  ${hit.snippet}`);
}));
cli.command('export <id>').description('Export a session as portable JSON').requiredOption('-o, --out <file>', 'Destination file').action((id: string, options: { out: string }) => {
  const { store } = project();
  try {
    const archive = new SessionTransfer(store).export(id);
    writeFileSync(options.out, JSON.stringify(archive, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    console.log(`✓ Session ${id} exported: ${resolve(options.out)}`);
  } finally { store.close(); }
});
cli.command('import <file>').description('Import a JSON session archive').action((file: string) => {
  if (statSync(file).size > 10_000_000) throw new Error('Archive is too large (10 MB maximum).');
  const input: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const { store } = project();
  try {
    const session = new SessionTransfer(store).import(input);
    console.log(`✓ Session imported: ${session.id} — ${session.title}`);
  } finally { store.close(); }
});
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
    await launchIn(new ThreadPort(store, git, fork.path), fork.agentId, fork.path, options.structured === true);
  } finally { store.close(); }
});
forkCommand.command('check <id> <executable> [args...]').description('Run a command in a fork and record its result').action(async (id: string, executable: string, args: string[]) => {
  const { store } = project();
  try {
    const fork = new Forks(store, git, worktrees, cwd).get(id);
    const code = await new ThreadPort(store, git, fork.path).check(executable, args, new LocalCommandExecutor());
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
cli.command('snapshot').description('Capture the current Git state').action(() => withProject((app) => {
  const snapshot = app.snapshot();
  console.log(`✓ Snapshot ${snapshot.id.slice(0, 8)}: ${snapshot.git.changedFiles.length} changed file(s).`);
}));
cli.command('context').description('Preview context sent to an agent').option('-m, --mode <mode>', 'minimal, standard, deep, or full', contextMode).option('--explain', 'Show the token budget and sources').action((options: { mode?: ReturnType<typeof assertMode>; explain?: boolean }) => withProject((app) => {
  const pack = app.contextPack(options.mode ?? readConfig(cwd).context.defaultMode, loadExcludes(cwd));
  console.log(pack.text);
  if (options.explain) console.error(`\n${pack.tokens}/${pack.budget} tokens · Sources: ${pack.included.map((item) => item.source).join(', ')}${pack.omitted.length ? ` · Omitted: ${pack.omitted.join(', ')}` : ''}${pack.excludedPaths.length ? ` · Excluded: ${pack.excludedPaths.join(', ')}` : ''}`);
}));
cli.command('agents').description('List configured agents').action(() => {
  for (const agent of knownAgents()) console.log(`${runner.available(agent.command) ? '✓' : '·'} ${agent.id.padEnd(8)} ${agent.label} (${agent.command})`);
});
const config = cli.command('config').description('View or change project configuration');
config.command('show').description('Show effective configuration').action(() => console.log(JSON.stringify(readConfig(cwd), null, 2)));
config.command('set-default-mode <mode>').description('Set the default context mode').action((value: string) => withProject(() => {
  const setting = setDefaultMode(cwd, assertMode(value));
  console.log(`✓ Default mode: ${setting.context.defaultMode}`);
}));
const plugin = cli.command('plugin').description('Manage local agent adapters');
plugin.command('add <manifest>').description('Install an agent JSON manifest in the project').action((path: string) => {
  const value = installAgentPlugin(projectDir, path);
  console.log(`✓ Agent ${value.id} installed.`);
});
plugin.command('list').description('List project agent adapters').action(() => {
  for (const item of loadAgentPlugins(projectDir)) console.log(`${item.id} ${item.command}`);
});
cli.command('doctor').description('Check the local environment').action(() => {
  console.log(`Node     ${process.version}${Number(process.versions.node.split('.')[0]) >= 24 ? ' ✓' : ' (Node 24 required)'}`);
  console.log(`Project  ${existsSync(dbPath) ? 'initialized ✓' : 'not initialized'}`);
  console.log(`Git      ${git.read(cwd) ? 'repository found ✓' : 'no repository'}`);
  console.log(`Config   ${readConfig(cwd).context.defaultMode}`);
  for (const agent of knownAgents()) console.log(`${agent.label.padEnd(11)} ${runner.available(agent.command) ? 'available ✓' : 'missing'}`);
});
cli.command('tui').description('Open the interactive terminal menu').action(async () => withProjectAsync((app) => openMenu(app, cwd)));
cli.command('serve').description('Start a local API with a temporary token').option('-p, --port <port>', 'TCP port', '0').action(async (options: { port: string }) => withProjectAsync((app) => {
  const port = Number(options.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port.');
  return serveApi(app, cwd, port);
}));
cli.command('mcp').description('Start the MCP stdio server').action(async () => withProjectAsync((app) => serveMcp(app, cwd)));

async function launch(agentId: string, options: { structured?: boolean }): Promise<void> {
  await withProjectAsync(async (app) => launchIn(app, agentId, cwd, options.structured === true));
}
async function launchIn(app: ThreadPort, agentId: string, workingDirectory: string, structured = false, providerSessionId: string | null = null): Promise<void> {
    const adapter = findAgent(agentId);
    requireActive(app);
    if (!runner.available(adapter.command)) throw new Error(`${adapter.label} was not found (${adapter.command}). Run "threadport doctor".`);
    const tempDir = mkdtempSync(join(tmpdir(), 'threadport-'));
    const file = join(tempDir, 'handoff.md');
    try {
      writeFileSync(file, app.context(readConfig(cwd).context.defaultMode, loadExcludes(cwd)), { mode: 0o600 });
      console.log(`→ Launching ${adapter.label} with active session context.`);
      const activeAdapter = providerSessionId ? {
        ...adapter,
        args: (contextFile: string) => {
          if (!adapter.resumeArgs) throw new Error(`Native resumption is unavailable for ${agentId}.`);
          return adapter.resumeArgs(providerSessionId, contextFile);
        },
      } : structured ? {
        ...adapter,
        args: (contextFile: string) => {
          if (!adapter.structuredArgs) throw new Error(`Structured mode is unavailable for ${agentId}.`);
          return adapter.structuredArgs(contextFile);
        },
      } : adapter;
      const activeRunner = structured ? new StructuredAgentRunner(agentId, (event) => {
        if (event.kind === 'session') app.linkProviderSession(event.body);
        const kind = event.kind === 'error' ? 'error' : event.kind === 'command' ? 'command' : event.kind === 'usage' ? 'usage' : 'note';
        app.addRunRecord(kind, event.title || 'Agent event', event.body, event.kind === 'error' ? 'open' : 'info');
        if (event.kind === 'command' && event.exitCode !== undefined && /(?:^|\s)(?:test|pytest|vitest|jest)(?:\s|$)/i.test(event.title)) app.addRunRecord('test', event.title, event.body, event.exitCode === 0 ? 'done' : 'failed');
        if (event.kind === 'message') console.log(event.body);
      }) : runner;
      const run = await app.run(activeAdapter, activeRunner, file, providerSessionId);
      console.log(`\n✓ Run ${run.id} finished (${run.status}, exit code ${run.exitCode}).`);
      if (run.exitCode !== 0) process.exitCode = run.exitCode ?? 1;
    } finally { rmSync(tempDir, { recursive: true, force: true }); }
}
cli.command('run <agent>').description('Launch an agent with active session context').option('--structured', 'Capture provider JSON events').action(launch);
cli.command('switch <agent>').description('Hand off to another agent').option('--structured', 'Capture provider JSON events').action(launch);
cli.command('continue <agent>').description('Resume a linked native provider session').action(async (agentId: string) => withProjectAsync(async (app) => {
  const session = requireActive(app);
  const previous = app.runs(session.id).findLast((run) => run.agentId === agentId && Boolean(run.providerSessionId));
  if (!previous?.providerSessionId) throw new Error(`No linked ${agentId} session. First run "threadport run ${agentId} --structured".`);
  await launchIn(app, agentId, cwd, false, previous.providerSessionId);
}));

cli.parseAsync(process.argv).catch((error: unknown) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
