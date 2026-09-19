#!/usr/bin/env node
import { Command, InvalidArgumentError } from 'commander';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertMode } from '../../domain/model.js';
import { ThreadPort } from '../../application/threadport.js';
import { loadExcludes } from '../../infrastructure/privacy.js';
import { SqliteStore } from '../../infrastructure/sqlite-store.js';
import { GitCliReader } from '../../infrastructure/git.js';
import { adapterById, adapters, TerminalAgentRunner } from '../../infrastructure/agents.js';

const cwd = process.cwd();
const projectDir = join(cwd, '.threadport');
const dbPath = join(projectDir, 'threadport.sqlite');
const git = new GitCliReader();
const runner = new TerminalAgentRunner();

function project(create = false): { app: ThreadPort; store: SqliteStore } {
  if (!create && !existsSync(dbPath)) throw new Error('Projet non initialisé. Lancez « threadport init ».');
  if (create) mkdirSync(projectDir, { recursive: true, mode: 0o700 });
  const store = new SqliteStore(dbPath);
  const app = new ThreadPort(store, git, cwd);
  const recovered = app.recover();
  if (recovered) console.error(`↺ ${recovered} exécution(s) interrompue(s) récupérée(s).`);
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
  if (!session) throw new Error('Aucune session active. Lancez « threadport new <objectif> ».');
  return session;
}

function contextMode(value: string) {
  try { return assertMode(value); } catch (error: unknown) { throw new InvalidArgumentError(error instanceof Error ? error.message : String(error)); }
}

const cli = new Command();
cli.name('threadport').description('La continuité locale de vos sessions entre agents IA.').version('0.1.0').showHelpAfterError();

cli.command('init').description('Initialiser ThreadPort dans ce dossier').action(() => {
  if (existsSync(dbPath)) { console.log('✓ ThreadPort est déjà initialisé ici.'); return; }
  withProject(() => {
    console.log(`✓ Projet initialisé : ${resolve(projectDir)}`);
    if (!git.read(cwd)) console.log('ℹ Aucun dépôt Git détecté ; les captures Git seront indisponibles.');
    console.log('Prochaine étape : threadport new "Votre objectif"');
  }, true);
});
cli.command('new <objective>').description('Créer et activer une session').action((objective: string) => withProject((app) => {
  const session = app.newSession(objective);
  console.log(`✓ Session créée : ${session.id} — ${session.title}`);
  console.log('Prochaine étape : threadport run claude');
}));
cli.command('sessions').description('Lister les sessions').action(() => withProject((app) => {
  const sessions = app.sessions();
  if (!sessions.length) { console.log('Aucune session. Lancez « threadport new <objectif> ».'); return; }
  for (const item of sessions) console.log(`${item.status === 'active' ? '●' : '○'} ${item.id.padEnd(8)} ${item.status.padEnd(6)} ${item.title}`);
}));
cli.command('open <id>').description('Activer une session existante').action((id: string) => withProject((app) => {
  const session = app.open(id);
  console.log(`✓ Session active : ${session.id} — ${session.title}`);
}));
cli.command('resume <id>').description('Réactiver une session et afficher son contexte').option('-m, --mode <mode>', 'Niveau de contexte', contextMode, 'standard').action((id: string, options: { mode: ReturnType<typeof assertMode> }) => withProject((app) => {
  app.open(id);
  console.log(app.context(options.mode, loadExcludes(cwd)));
}));
cli.command('status').description('Afficher la session et l’état Git').action(() => withProject((app) => {
  const session = app.active();
  if (!session) { console.log('Aucune session active. Lancez « threadport new <objectif> ».'); return; }
  const state = git.read(cwd);
  const lastRun = app.runs(session.id).at(-1);
  console.log(`Session  ${session.id} — ${session.title}`);
  console.log(`État     ${session.status}`);
  console.log(`Agent    ${lastRun ? `${lastRun.agentId} (${lastRun.status})` : 'aucun'}`);
  console.log(`Git      ${state ? `${state.branch ?? '(détaché)'} · ${state.changedFiles.length} fichier(s) modifié(s)` : 'indisponible'}`);
  console.log(`Décisions ${app.decisions(session.id).length}`);
}));
cli.command('timeline').description('Afficher les événements de la session active').action(() => withProject((app) => {
  const events = app.events(requireActive(app).id);
  for (const event of events) console.log(`${event.createdAt}  ${event.type.padEnd(23)} ${event.message}`);
}));
cli.command('decision <title>').description('Consigner une décision technique').option('-r, --rationale <text>', 'Justification', '').action((title: string, options: { rationale: string }) => withProject((app) => {
  app.decide(title, options.rationale);
  console.log('✓ Décision enregistrée.');
}));
cli.command('decisions').description('Lister les décisions').action(() => withProject((app) => {
  for (const item of app.decisions(requireActive(app).id)) console.log(`• ${item.title}${item.rationale ? ` — ${item.rationale}` : ''}`);
}));
cli.command('snapshot').description('Capturer l’état Git actuel').action(() => withProject((app) => {
  const snapshot = app.snapshot();
  console.log(`✓ Snapshot ${snapshot.id.slice(0, 8)} : ${snapshot.git.changedFiles.length} fichier(s) modifié(s).`);
}));
cli.command('context').description('Prévisualiser le contexte transmis à un agent').option('-m, --mode <mode>', 'minimal, standard, deep ou full', contextMode, 'standard').action((options: { mode: ReturnType<typeof assertMode> }) => withProject((app) => {
  console.log(app.context(options.mode, loadExcludes(cwd)));
}));
cli.command('agents').description('Afficher les agents configurés').action(() => {
  for (const agent of adapters) console.log(`${runner.available(agent.command) ? '✓' : '·'} ${agent.id.padEnd(8)} ${agent.label} (${agent.command})`);
});
cli.command('doctor').description('Vérifier l’environnement local').action(() => {
  console.log(`Node     ${process.version}${Number(process.versions.node.split('.')[0]) >= 24 ? ' ✓' : ' (Node 24 requis)'}`);
  console.log(`Projet   ${existsSync(dbPath) ? 'initialisé ✓' : 'non initialisé'}`);
  console.log(`Git      ${git.read(cwd) ? 'dépôt détecté ✓' : 'pas de dépôt'}`);
  for (const agent of adapters) console.log(`${agent.label.padEnd(11)} ${runner.available(agent.command) ? 'disponible ✓' : 'absent'}`);
});

async function launch(agentId: string): Promise<void> {
  await withProjectAsync(async (app) => {
    const adapter = adapterById(agentId);
    requireActive(app);
    if (!runner.available(adapter.command)) throw new Error(`${adapter.label} est introuvable (${adapter.command}). Lancez « threadport doctor ».`);
    const tempDir = mkdtempSync(join(tmpdir(), 'threadport-'));
    const file = join(tempDir, 'handoff.md');
    try {
      writeFileSync(file, app.context('standard', loadExcludes(cwd)), { mode: 0o600 });
      console.log(`→ Lancement de ${adapter.label} avec le contexte de la session active.`);
      const run = await app.run(adapter, runner, file);
      console.log(`\n✓ Exécution ${run.id} terminée (${run.status}, code ${run.exitCode}).`);
      if (run.exitCode !== 0) process.exitCode = run.exitCode ?? 1;
    } finally { rmSync(tempDir, { recursive: true, force: true }); }
  });
}
cli.command('run <agent>').description('Lancer un agent avec le contexte actif').action(launch);
cli.command('switch <agent>').description('Passer à un autre agent avec un handoff').action(launch);

cli.parseAsync(process.argv).catch((error: unknown) => {
  console.error(`Erreur : ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
