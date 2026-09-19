import { createInterface } from 'node:readline/promises';
import type { ThreadPort } from '../../application/threadport.js';
import { loadExcludes } from '../../infrastructure/privacy.js';
import { readConfig } from '../../infrastructure/config.js';

export async function openMenu(app: ThreadPort, cwd: string): Promise<void> {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const current = app.active();
      console.log(`\nThreadPort  ·  ${current ? `${current.id} — ${current.title}` : 'aucune session active'}`);
      console.log('1 Sessions  2 Contexte  3 Timeline  4 Tâches  5 Décisions  6 Ouvrir  7 Note  8 Tâche  0 Quitter');
      const choice = (await input.question('> ')).trim();
      if (choice === '0') return;
      if (choice === '1') for (const item of app.sessions()) console.log(`${item.id} ${item.status.padEnd(6)} ${item.title}`);
      else if (choice === '2') console.log(app.context(readConfig(cwd).context.defaultMode, loadExcludes(cwd)));
      else if (choice === '3' && current) for (const event of app.events(current.id)) console.log(`${event.createdAt} ${event.type} ${event.message}`);
      else if (choice === '4' && current) for (const item of app.records(current.id).filter((record) => record.kind === 'task')) console.log(`${item.id} ${item.status} ${item.title}`);
      else if (choice === '5' && current) for (const item of app.decisions(current.id)) console.log(`${item.title} — ${item.rationale}`);
      else if (choice === '6') { const id = (await input.question('ID de session : ')).trim(); console.log(`✓ ${app.open(id).title}`); }
      else if (choice === '7' && current) { const value = (await input.question('Note : ')).trim(); app.addRecord('note', value); }
      else if (choice === '8' && current) { const value = (await input.question('Tâche : ')).trim(); app.addRecord('task', value, '', 'open'); }
      else console.log('Choix inconnu ou aucune session active.');
    }
  } finally { input.close(); }
}
