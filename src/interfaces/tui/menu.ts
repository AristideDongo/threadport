import { createInterface } from 'node:readline/promises';
import type { ThreadPort } from '../../application/threadport.js';
import { loadExcludes } from '../../infrastructure/privacy.js';
import { readConfig, verificationCommands } from '../../infrastructure/config.js';
import { LocalCommandExecutor } from '../../infrastructure/command-executor.js';
import { readFileSync, statSync } from 'node:fs';

export async function openMenu(app: ThreadPort, cwd: string): Promise<void> {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const current = app.active();
      console.log(`\nThreadPort  ·  ${current ? `${current.id} — ${current.title}` : 'no active session'}`);
      console.log('1 Sessions  2 Context  3 Timeline  4 Tasks  5 Decisions  6 Open');
      console.log('7 Note  8 Add task  9 Summary  A Search  B Complete task  C Runs');
      console.log('D Finish  E Rename  F Edit record  G Delete record  H Handoff draft');
      console.log('I Verify  J Privacy audit  K Link issue/PR  L Save handoff  0 Quit');
      const choice = (await input.question('> ')).trim();
      if (choice === '0') return;
      if (choice === '1')
        for (const item of app.sessions()) console.log(`${item.id} ${item.status.padEnd(6)} ${item.title}`);
      else if (choice === '2') console.log(app.context(readConfig(cwd).context.defaultMode, loadExcludes(cwd)));
      else if (choice === '3' && current)
        for (const event of app.events(current.id)) console.log(`${event.createdAt} ${event.type} ${event.message}`);
      else if (choice === '4' && current)
        for (const item of app.records(current.id).filter((record) => record.kind === 'task'))
          console.log(`${item.id} ${item.status} ${item.title}`);
      else if (choice === '5' && current)
        for (const item of app.decisions(current.id)) console.log(`${item.title} — ${item.rationale}`);
      else if (choice === '6') {
        const id = (await input.question('Session ID: ')).trim();
        console.log(`✓ ${app.open(id).title}`);
      } else if (choice === '7' && current) {
        const value = (await input.question('Note : ')).trim();
        app.addRecord('note', value);
      } else if (choice === '8' && current) {
        const value = (await input.question('Task: ')).trim();
        app.addRecord('task', value, '', 'open');
      } else if (choice === '9' && current) console.log(app.summarize().body);
      else if (choice.toLowerCase() === 'a') {
        const query = (await input.question('Search: ')).trim();
        for (const hit of app.search(query)) console.log(`${hit.source} ${hit.title} — ${hit.snippet}`);
      } else if (choice.toLowerCase() === 'b' && current) {
        const id = (await input.question('Task ID: ')).trim();
        console.log(`✓ ${app.completeTask(id).title}`);
      } else if (choice.toLowerCase() === 'c' && current)
        for (const run of app.runs(current.id))
          console.log(`${run.id} ${run.agentId} ${run.status} ${run.exitCode ?? ''}`);
      else if (choice.toLowerCase() === 'd' && current) console.log(`✓ Finished ${app.finish(current.id).id}`);
      else if (choice.toLowerCase() === 'e' && current) {
        const title = (await input.question('New session title: ')).trim();
        console.log(`✓ ${app.rename(current.id, title).title}`);
      } else if (choice.toLowerCase() === 'f' && current) {
        const id = (await input.question('Record ID: ')).trim();
        const title = (await input.question('New title: ')).trim();
        console.log(`✓ ${app.updateRecord(id, title).title}`);
      } else if (choice.toLowerCase() === 'g' && current) {
        const id = (await input.question('Record ID: ')).trim();
        app.deleteRecord(id);
        console.log(`✓ Deleted ${id}`);
      } else if (choice.toLowerCase() === 'h' && current) console.log(app.handoffDraft());
      else if (choice.toLowerCase() === 'i' && current) {
        const commands = verificationCommands(cwd);
        if (!commands.length)
          console.log('No checks configured. Add verification.commands to .threadport/config.json.');
        else {
          const report = await app.verify(commands, new LocalCommandExecutor());
          console.log(report.passed ? '✓ Verification passed.' : '✗ Verification failed or Git state changed.');
        }
      } else if (choice.toLowerCase() === 'j' && current) console.log(JSON.stringify(app.privacyAudit(), null, 2));
      else if (choice.toLowerCase() === 'k' && current) {
        const kind = (await input.question('Type (issue/pr): ')).trim();
        const url = (await input.question('GitHub URL: ')).trim();
        if (kind !== 'issue' && kind !== 'pr') console.log('Choose issue or pr.');
        else console.log(`✓ ${app.linkWork(kind, url).title}`);
      } else if (choice.toLowerCase() === 'l' && current) {
        const file = (await input.question('Handoff Markdown file: ')).trim();
        if (statSync(file).size > 18_000) throw new Error('Handoff file is too large.');
        console.log(`✓ ${app.saveHandoff(readFileSync(file, 'utf8')).id}`);
      } else console.log('Unknown choice or no active session.');
    }
  } finally {
    input.close();
  }
}
