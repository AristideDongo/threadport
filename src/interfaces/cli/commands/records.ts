import type { Command } from 'commander';
import { LocalCommandExecutor } from '../../../infrastructure/command-executor.js';
import { cwd, git, projectPath, requireActive, withProject, withProjectAsync } from '../runtime.js';

export function registerRecordCommands(cli: Command): void {
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
    const item = app.addRecord('file', projectPath(path), options.details);
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
    const item = app.addRecord('artifact', projectPath(path), options.details);
    console.log(`✓ Artifact ${item.id} recorded.`);
  }));
  cli.command('summary').description('Summarize the active session').action(() => withProject((app) => {
    const item = app.summarize();
    console.log(`${item.title}\n${item.body}`);
  }));
}
