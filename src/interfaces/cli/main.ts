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
cli.name('threadport').description('La continuité locale de vos sessions entre agents IA.').version(packageVersion).showHelpAfterError();

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
cli.command('resume <id>').description('Réactiver une session et afficher son contexte').option('-m, --mode <mode>', 'Niveau de contexte', contextMode).action((id: string, options: { mode?: ReturnType<typeof assertMode> }) => withProject((app) => {
  app.open(id);
  console.log(app.context(options.mode ?? readConfig(cwd).context.defaultMode, loadExcludes(cwd)));
}));
cli.command('status').description('Afficher la session et l’état Git').action(() => withProject((app) => {
  const session = app.active();
  if (!session) { console.log('Aucune session active. Lancez « threadport new <objectif> ».'); return; }
  const state = git.read(cwd);
  const lastRun = app.runs(session.id).at(-1);
  console.log(`Session  ${session.id} — ${session.title}`);
  console.log(`État     ${session.status}`);
  console.log(`Agent    ${lastRun ? `${lastRun.agentId} (${lastRun.status})${lastRun.providerSessionId ? ` · session ${lastRun.providerSessionId}` : ''}` : 'aucun'}`);
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
cli.command('note <text>').description('Consigner une note de travail').action((value: string) => withProject((app) => {
  const item = app.addRecord('note', value);
  console.log(`✓ Note ${item.id} enregistrée.`);
}));
const task = cli.command('task').description('Gérer les tâches de la session');
task.command('add <title>').description('Ajouter une tâche ouverte').action((title: string) => withProject((app) => {
  const item = app.addRecord('task', title, '', 'open');
  console.log(`✓ Tâche ${item.id} ajoutée.`);
}));
task.command('done <id>').description('Marquer une tâche comme terminée').action((id: string) => withProject((app) => {
  const item = app.completeTask(id);
  console.log(`✓ Tâche terminée : ${item.title}`);
}));
task.command('list').description('Lister les tâches').action(() => withProject((app) => {
  for (const item of app.records(requireActive(app).id).filter((entry) => entry.kind === 'task')) console.log(`${item.status === 'done' ? '✓' : '○'} ${item.id} ${item.title}`);
}));
cli.command('error <title>').description('Consigner une erreur').option('-d, --details <text>', 'Détails', '').action((title: string, options: { details: string }) => withProject((app) => {
  const item = app.addRecord('error', title, options.details, 'open');
  console.log(`✓ Erreur ${item.id} enregistrée.`);
}));
cli.command('test-result <title>').description('Consigner un résultat de test').requiredOption('-s, --status <status>', 'passed ou failed').option('-d, --details <text>', 'Détails', '').action((title: string, options: { status: string; details: string }) => withProject((app) => {
  if (options.status !== 'passed' && options.status !== 'failed') throw new Error('Le statut doit être passed ou failed.');
  const item = app.addRecord('test', title, options.details, options.status === 'passed' ? 'done' : 'failed');
  console.log(`✓ Résultat ${item.id} enregistré.`);
}));
cli.command('check <executable> [args...]').description('Exécuter une commande et consigner son résultat').action(async (executable: string, args: string[]) => withProjectAsync(async (app) => {
  const code = await app.check(executable, args, new LocalCommandExecutor());
  if (code !== 0) process.exitCode = code;
}));
cli.command('command-log <command>').description('Consigner une commande exécutée').option('-d, --details <text>', 'Résultat', '').action((value: string, options: { details: string }) => withProject((app) => {
  const item = app.addRecord('command', value, options.details);
  console.log(`✓ Commande ${item.id} enregistrée.`);
}));
cli.command('memory <text>').description('Ajouter une information durable au projet').action((value: string) => withProject((app) => {
  const item = app.addRecord('memory', value);
  console.log(`✓ Mémoire ${item.id} enregistrée.`);
}));
cli.command('constraint <text>').description('Consigner une contrainte de la session').action((value: string) => withProject((app) => {
  const item = app.addRecord('constraint', value);
  console.log(`✓ Contrainte ${item.id} enregistrée.`);
}));
cli.command('file <path>').description('Marquer un fichier pertinent').option('-d, --details <text>', 'Raison', '').action((path: string, options: { details: string }) => withProject((app) => {
  const item = app.addRecord('file', path, options.details);
  console.log(`✓ Fichier ${item.id} enregistré.`);
}));
cli.command('files').description('Lister les fichiers pertinents et modifiés').action(() => withProject((app) => {
  const session = requireActive(app);
  const marked = app.records(session.id).filter((item) => item.kind === 'file');
  const changed = git.read(cwd)?.changedFiles ?? [];
  for (const item of marked) console.log(`• ${item.title}${item.body ? ` — ${item.body}` : ''}`);
  for (const path of changed) if (!marked.some((item) => item.title === path)) console.log(`~ ${path}`);
}));
cli.command('artifact <path>').description('Consigner un artefact de travail').option('-d, --details <text>', 'Description', '').action((path: string, options: { details: string }) => withProject((app) => {
  const item = app.addRecord('artifact', path, options.details);
  console.log(`✓ Artefact ${item.id} enregistré.`);
}));
cli.command('summary').description('Produire un résumé de la session active').action(() => withProject((app) => {
  const item = app.summarize();
  console.log(`${item.title}\n${item.body}`);
}));
cli.command('search <query>').description('Rechercher dans les sessions, décisions et notes').action((query: string) => withProject((app) => {
  const hits = app.search(query);
  if (!hits.length) { console.log('Aucun résultat.'); return; }
  for (const hit of hits) console.log(`${hit.source.padEnd(8)} ${hit.sessionId} ${hit.title}\n  ${hit.snippet}`);
}));
cli.command('export <id>').description('Exporter une session en JSON portable').requiredOption('-o, --out <file>', 'Fichier de destination').action((id: string, options: { out: string }) => {
  const { store } = project();
  try {
    const archive = new SessionTransfer(store).export(id);
    writeFileSync(options.out, JSON.stringify(archive, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    console.log(`✓ Session ${id} exportée : ${resolve(options.out)}`);
  } finally { store.close(); }
});
cli.command('import <file>').description('Importer une archive de session JSON').action((file: string) => {
  if (statSync(file).size > 10_000_000) throw new Error('Archive trop volumineuse (10 Mo maximum).');
  const input: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const { store } = project();
  try {
    const session = new SessionTransfer(store).import(input);
    console.log(`✓ Session importée : ${session.id} — ${session.title}`);
  } finally { store.close(); }
});
const forkCommand = cli.command('fork').description('Expérimenter dans des worktrees Git isolés');
forkCommand.option('--agents <ids>', 'Agents séparés par une virgule').action((options: { agents?: string }) => {
  if (!options.agents) { forkCommand.help(); return; }
  const agents = options.agents.split(',').map((id) => id.trim()).filter(Boolean);
  if (!agents.length) throw new Error('Indiquez au moins un agent.');
  for (const id of agents) findAgent(id);
  const { store } = project();
  try {
    const forks = new Forks(store, git, worktrees, cwd).create(agents);
    for (const item of forks) console.log(`✓ ${item.id} ${item.agentId} → ${item.path}`);
  } finally { store.close(); }
});
forkCommand.command('list').description('Lister les forks de la session').action(() => {
  const { store } = project();
  try { for (const item of new Forks(store, git, worktrees, cwd).list()) console.log(`${item.id} ${item.agentId.padEnd(8)} ${item.branch} ${item.path}`); }
  finally { store.close(); }
});
forkCommand.command('remove <id>').description('Supprimer un worktree propre (conserve sa branche)').action((id: string) => {
  const { store } = project();
  try { new Forks(store, git, worktrees, cwd).remove(id); console.log(`✓ Worktree ${id} supprimé ; branche conservée.`); }
  finally { store.close(); }
});
forkCommand.command('run <id>').description('Lancer l’agent associé dans son worktree').option('--structured', 'Capturer les événements JSON du fournisseur').action(async (id: string, options: { structured?: boolean }) => {
  const { store } = project();
  try {
    const fork = new Forks(store, git, worktrees, cwd).get(id);
    await launchIn(new ThreadPort(store, git, fork.path), fork.agentId, fork.path, options.structured === true);
  } finally { store.close(); }
});
forkCommand.command('check <id> <executable> [args...]').description('Exécuter un test dans un fork et enregistrer le résultat').action(async (id: string, executable: string, args: string[]) => {
  const { store } = project();
  try {
    const fork = new Forks(store, git, worktrees, cwd).get(id);
    const code = await new ThreadPort(store, git, fork.path).check(executable, args, new LocalCommandExecutor());
    if (code !== 0) process.exitCode = code;
  } finally { store.close(); }
});
cli.command('compare <first> <second>').description('Comparer les modifications de deux forks').option('--diff', 'Afficher les diffs complets (plafonnés)').action((first: string, second: string, options: { diff?: boolean }) => {
  const { store } = project();
  try {
    const forks = new Forks(store, git, worktrees, cwd);
    const comparison = forks.compare(first, second);
    for (const item of comparison) console.log(`${item.fork.id} (${item.fork.agentId})\n  ${item.stats.files} fichiers · +${item.stats.added} / -${item.stats.deleted} lignes\n  ${item.runs.length} run(s) · ${item.commands} commande(s) · ${item.errors} erreur(s) · ${Math.round(item.durationMs / 1000)} s\n  ${item.tests.filter((test) => test.status === 'done').length} test(s) réussis · ${item.tests.filter((test) => test.status === 'failed').length} échec(s) · ${item.tokens || 'n/d'} tokens enregistrés\n  ${item.stats.paths.join(', ') || 'aucune modification'}`);
    if (options.diff) for (const item of comparison) console.log(`\n--- ${item.fork.id} ---\n${redact(safeDiff(forks.diff(item.fork.id), loadExcludes(cwd)))}`);
  } finally { store.close(); }
});
cli.command('snapshot').description('Capturer l’état Git actuel').action(() => withProject((app) => {
  const snapshot = app.snapshot();
  console.log(`✓ Snapshot ${snapshot.id.slice(0, 8)} : ${snapshot.git.changedFiles.length} fichier(s) modifié(s).`);
}));
cli.command('context').description('Prévisualiser le contexte transmis à un agent').option('-m, --mode <mode>', 'minimal, standard, deep ou full', contextMode).option('--explain', 'Afficher le budget et la provenance').action((options: { mode?: ReturnType<typeof assertMode>; explain?: boolean }) => withProject((app) => {
  const pack = app.contextPack(options.mode ?? readConfig(cwd).context.defaultMode, loadExcludes(cwd));
  console.log(pack.text);
  if (options.explain) console.error(`\n${pack.tokens}/${pack.budget} tokens · Sources : ${pack.included.map((item) => item.source).join(', ')}${pack.omitted.length ? ` · Omis : ${pack.omitted.join(', ')}` : ''}${pack.excludedPaths.length ? ` · Exclus : ${pack.excludedPaths.join(', ')}` : ''}`);
}));
cli.command('agents').description('Afficher les agents configurés').action(() => {
  for (const agent of knownAgents()) console.log(`${runner.available(agent.command) ? '✓' : '·'} ${agent.id.padEnd(8)} ${agent.label} (${agent.command})`);
});
const config = cli.command('config').description('Afficher ou modifier la configuration projet');
config.command('show').description('Afficher la configuration effective').action(() => console.log(JSON.stringify(readConfig(cwd), null, 2)));
config.command('set-default-mode <mode>').description('Choisir le mode de contexte par défaut').action((value: string) => withProject(() => {
  const setting = setDefaultMode(cwd, assertMode(value));
  console.log(`✓ Mode par défaut : ${setting.context.defaultMode}`);
}));
const plugin = cli.command('plugin').description('Gérer les adapters locaux');
plugin.command('add <manifest>').description('Installer un manifest JSON d’agent dans le projet').action((path: string) => {
  const value = installAgentPlugin(projectDir, path);
  console.log(`✓ Agent ${value.id} installé.`);
});
plugin.command('list').description('Lister les adapters du projet').action(() => {
  for (const item of loadAgentPlugins(projectDir)) console.log(`${item.id} ${item.command}`);
});
cli.command('doctor').description('Vérifier l’environnement local').action(() => {
  console.log(`Node     ${process.version}${Number(process.versions.node.split('.')[0]) >= 24 ? ' ✓' : ' (Node 24 requis)'}`);
  console.log(`Projet   ${existsSync(dbPath) ? 'initialisé ✓' : 'non initialisé'}`);
  console.log(`Git      ${git.read(cwd) ? 'dépôt détecté ✓' : 'pas de dépôt'}`);
  console.log(`Config   ${readConfig(cwd).context.defaultMode}`);
  for (const agent of knownAgents()) console.log(`${agent.label.padEnd(11)} ${runner.available(agent.command) ? 'disponible ✓' : 'absent'}`);
});
cli.command('tui').description('Ouvrir un menu terminal interactif').action(async () => withProjectAsync((app) => openMenu(app, cwd)));
cli.command('serve').description('Démarrer une API locale avec jeton temporaire').option('-p, --port <port>', 'Port TCP', '0').action(async (options: { port: string }) => withProjectAsync((app) => {
  const port = Number(options.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port invalide.');
  return serveApi(app, cwd, port);
}));
cli.command('mcp').description('Démarrer le serveur MCP stdio').action(async () => withProjectAsync((app) => serveMcp(app, cwd)));

async function launch(agentId: string, options: { structured?: boolean }): Promise<void> {
  await withProjectAsync(async (app) => launchIn(app, agentId, cwd, options.structured === true));
}
async function launchIn(app: ThreadPort, agentId: string, workingDirectory: string, structured = false, providerSessionId: string | null = null): Promise<void> {
    const adapter = findAgent(agentId);
    requireActive(app);
    if (!runner.available(adapter.command)) throw new Error(`${adapter.label} est introuvable (${adapter.command}). Lancez « threadport doctor ».`);
    const tempDir = mkdtempSync(join(tmpdir(), 'threadport-'));
    const file = join(tempDir, 'handoff.md');
    try {
      writeFileSync(file, app.context(readConfig(cwd).context.defaultMode, loadExcludes(cwd)), { mode: 0o600 });
      console.log(`→ Lancement de ${adapter.label} avec le contexte de la session active.`);
      const activeAdapter = providerSessionId ? {
        ...adapter,
        args: (contextFile: string) => {
          if (!adapter.resumeArgs) throw new Error(`La reprise native n'est pas disponible pour ${agentId}.`);
          return adapter.resumeArgs(providerSessionId, contextFile);
        },
      } : structured ? {
        ...adapter,
        args: (contextFile: string) => {
          if (!adapter.structuredArgs) throw new Error(`Le mode structuré n'est pas disponible pour ${agentId}.`);
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
      console.log(`\n✓ Exécution ${run.id} terminée (${run.status}, code ${run.exitCode}).`);
      if (run.exitCode !== 0) process.exitCode = run.exitCode ?? 1;
    } finally { rmSync(tempDir, { recursive: true, force: true }); }
}
cli.command('run <agent>').description('Lancer un agent avec le contexte actif').option('--structured', 'Capturer les événements JSON du fournisseur').action(launch);
cli.command('switch <agent>').description('Passer à un autre agent avec un handoff').option('--structured', 'Capturer les événements JSON du fournisseur').action(launch);
cli.command('continue <agent>').description('Reprendre la session native du fournisseur liée à ThreadPort').action(async (agentId: string) => withProjectAsync(async (app) => {
  const session = requireActive(app);
  const previous = app.runs(session.id).findLast((run) => run.agentId === agentId && Boolean(run.providerSessionId));
  if (!previous?.providerSessionId) throw new Error(`Aucune session ${agentId} liée. Lancez d'abord « threadport run ${agentId} --structured ».`);
  await launchIn(app, agentId, cwd, false, previous.providerSessionId);
}));

cli.parseAsync(process.argv).catch((error: unknown) => {
  console.error(`Erreur : ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
