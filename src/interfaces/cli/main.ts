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
import { readConfig, setDefaultMode, verificationCommands } from '../../infrastructure/config.js';
import { SqliteStore } from '../../infrastructure/sqlite-store.js';
import { GitCliReader } from '../../infrastructure/git.js';
import { GitWorktrees } from '../../infrastructure/git-worktrees.js';
import { Forks } from '../../application/forks.js';
import { LocalCommandExecutor } from '../../infrastructure/command-executor.js';
import { adapterById, adapters, agentVersion, TerminalAgentRunner } from '../../infrastructure/agents.js';
import { installAgentPlugin, loadAgentPlugins } from '../../infrastructure/agent-plugins.js';
import { openMenu } from '../tui/menu.js';
import { serveApi } from '../api/server.js';
import { serveMcp } from '../mcp/server.js';
import { StructuredAgentRunner } from '../../infrastructure/structured-agent.js';
import { packageVersion } from '../../infrastructure/package-info.js';
import { findProjectRoot, handleLifecycleHook, installLifecycleHooks } from '../../infrastructure/lifecycle-hooks.js';

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
  const app = new ThreadPort(store, git, cwd, loadExcludes(cwd));
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
  const available = knownAgents().filter((agent) => runner.available(agent.command));
  console.log(available[0] ? `Next step: threadport run ${available[0].id}` : 'No agent CLI found. Run "threadport doctor" or use "threadport context".');
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
cli.command('finish <id>').description('Mark a session as finished').action((id: string) => withProject((app) => {
  const session = app.finish(id);
  console.log(`✓ Session finished: ${session.id} — ${session.title}`);
}));
cli.command('rename <id> <title>').description('Rename a session').action((id: string, title: string) => withProject((app) => {
  const session = app.rename(id, title);
  console.log(`✓ Session renamed: ${session.id} — ${session.title}`);
}));
cli.command('delete <id>').description('Permanently delete a session and its history').action((id: string) => withProject((app) => {
  app.deleteSession(id);
  console.log(`✓ Session deleted: ${id}`);
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
const recordCommand = cli.command('record').description('Edit or delete session records');
recordCommand.command('edit <id> <title>').description('Edit a record title and optional details').option('-d, --details <text>', 'Replace record details').action((id: string, title: string, options: { details?: string }) => withProject((app) => {
  const item = app.updateRecord(id, title, options.details);
  console.log(`✓ Record updated: ${item.id}`);
}));
recordCommand.command('delete <id>').description('Delete a record').action((id: string) => withProject((app) => {
  app.deleteRecord(id);
  console.log(`✓ Record deleted: ${id}`);
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
const handoff = cli.command('handoff').description('Draft and review a cross-agent handoff');
handoff.command('draft').description('Show a sourced handoff draft').option('-o, --out <file>', 'Write a new Markdown file for review').action((options: { out?: string }) => withProject((app) => {
  const draft = app.handoffDraft();
  if (options.out) { writeFileSync(options.out, draft + '\n', { mode: 0o600, flag: 'wx' }); console.log(`✓ Handoff draft: ${resolve(options.out)}`); }
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
    writeFileSync(options.out, JSON.stringify(archive, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
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
    await launchIn(new ThreadPort(store, git, fork.path, loadExcludes(cwd)), fork.agentId, fork.path, options.structured === true);
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
const privacy = cli.command('privacy').description('Manage stored private data');
privacy.command('audit').description('Preview redaction and excluded references before sharing').option('--show-context', 'Print the redacted context pack').action((options: { showContext?: boolean }) => withProject((app) => {
  const mode = readConfig(cwd).context.defaultMode;
  const report = app.privacyAudit(mode);
  console.log(`Redaction candidates: ${report.redactedFields}\nExcluded references: ${report.excludedReferences}\nContext tokens: ${report.contextTokens}`);
  for (const warning of report.warnings) console.log(`⚠ ${warning}`);
  if (options.showContext) console.log(`\n${app.context(mode, loadExcludes(cwd))}`);
}));
privacy.command('scrub').description('Redact existing records and remove excluded file references').action(() => withProject((app) => {
  const result = app.scrub();
  console.log(`✓ Privacy scrub complete: ${result.updated} updated, ${result.removed} excluded records removed.`);
}));
const hook = cli.command('hook').description('Install and receive optional agent lifecycle hooks');
hook.command('install <agent>').description('Install local Claude or Codex hooks in this project').action((agent: string) => {
  if (agent !== 'claude' && agent !== 'codex') throw new Error('Choose claude or codex.');
  if (!existsSync(dbPath)) throw new Error('Initialize the project first with "threadport init".');
  console.log(`✓ Hooks installed: ${installLifecycleHooks(cwd, agent)}`);
  if (agent === 'codex') console.log('Review and trust the new project hooks with /hooks in Codex.');
});
hook.command('ingest <agent>').description('Receive a lifecycle event from an agent').action(async (agent: string) => {
  if (agent !== 'claude' && agent !== 'codex') return;
  const root = findProjectRoot(cwd);
  if (!root) return;
  let input = '';
  for await (const chunk of process.stdin) {
    input += String(chunk);
    if (input.length > 128_000) return;
  }
  let value: unknown;
  try { value = JSON.parse(input) as unknown; } catch { return; }
  const store = new SqliteStore(join(root, '.threadport', 'threadport.sqlite'));
  try {
    const app = new ThreadPort(store, git, root, loadExcludes(root));
    const output = handleLifecycleHook(app, root, agent, value);
    if (output) process.stdout.write(output + '\n');
  } finally { store.close(); }
});
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
  for (const agent of knownAgents()) {
    const guide = agent.id === 'claude' ? ' · https://code.claude.com/docs/en/setup' : agent.id === 'codex' ? ' · https://developers.openai.com/codex/cli/' : '';
    console.log(`${agent.label.padEnd(11)} ${runner.available(agent.command) ? `${agentVersion(agent.command) ?? 'available'} ✓` : `missing${guide}`}`);
  }
  console.log(`Checks   ${verificationCommands(cwd).length} configured or detected`);
  console.log(`Hooks    Claude ${existsSync(join(cwd, '.claude', 'settings.local.json')) ? 'configured' : 'optional'} · Codex ${existsSync(join(cwd, '.codex', 'hooks.json')) ? 'configured' : 'optional'}`);
  console.log('Structured capture should be checked after agent CLI upgrades.');
});
cli.command('tui').description('Open the interactive terminal menu').action(async () => withProjectAsync((app) => openMenu(app, cwd)));
cli.command('serve').description('Start a local API with a temporary token').option('-p, --port <port>', 'TCP port', '0').action(async (options: { port: string }) => withProjectAsync((app) => {
  const port = Number(options.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port.');
  return serveApi(app, cwd, port);
}));
const mcp = cli.command('mcp').description('Start or configure the MCP server');
mcp.action(async () => withProjectAsync((app) => serveMcp(app, cwd)));
mcp.command('setup').description('Show commands to connect Claude Code or Codex to this project').action(() => {
  console.log('From this project directory, configure an MCP client with one of these commands:');
  console.log('  codex mcp add threadport -- threadport mcp');
  console.log('  claude mcp add --scope project threadport -- threadport mcp');
  console.log('The client must start ThreadPort with this project as its working directory.');
});

async function launch(agentId: string, options: { structured?: boolean }): Promise<void> {
  await withProjectAsync(async (app) => launchIn(app, agentId, cwd, options.structured === true));
}
async function launchIn(app: ThreadPort, agentId: string, workingDirectory: string, structured = false, providerSessionId: string | null = null): Promise<void> {
    const adapter = findAgent(agentId);
    requireActive(app);
    if (!runner.available(adapter.command)) {
      const guide = agentId === 'claude' ? ' Install Claude Code: https://code.claude.com/docs/en/setup' : agentId === 'codex' ? ' Install Codex CLI: https://developers.openai.com/codex/cli/' : '';
      throw new Error(`${adapter.label} was not found (${adapter.command}). Run "threadport doctor".${guide}`);
    }
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
      if (run.status === 'failed' && agentId === 'claude') console.error('If Claude asked you to trust this folder and you declined, review the folder and rerun the command.');
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
