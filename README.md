# ThreadPort

**One context. Any AI agent.**

ThreadPort conserve le contexte d'une tâche de développement dans le projet et le transmet à Claude Code, Codex ou un agent configuré localement. Chaque session possède une timeline, des décisions, des tâches, des notes, des résultats de tests, des exécutions d'agents et des captures Git. Les données restent dans une base SQLite locale.

Le transfert conserve les informations enregistrées dans la session et les événements exposés par les agents en mode structuré.

## Installation

Prérequis : Node.js **24+**, npm et, pour les fonctions Git, un dépôt Git. Installez Claude Code et/ou Codex CLI dans `PATH` pour lancer ces agents.

```bash
npm install --global threadport
threadport --help
```

## Parcours rapide : Claude → Codex

Depuis **la racine du projet à suivre** :

```bash
threadport init
threadport new "Corriger la rotation des jetons"
threadport task add "Écrire un test de concurrence"
threadport decision "Conserver les identifiants dans Redis" -r "Révocation partagée"
threadport context --explain
threadport run claude
```

Après la sortie de Claude, vous pouvez consigner le travail que son interface interactive ne fournit pas à ThreadPort :

```bash
threadport note "La collision survient pendant le renouvellement simultané"
threadport check npm test
threadport summary
threadport switch codex
```

Pour une **capture structurée** des événements fournisseur, utilisez `--structured`. Ce mode lance l'agent sans interface interactive et enregistre les commandes, messages finaux, erreurs et identifiants de session présents dans le flux JSON :

```bash
threadport run codex --structured
threadport status
threadport continue codex
```

`continue` reprend la session native du fournisseur si un identifiant a été capturé par un run structuré. `threadport resume <id>` réactive, lui, une **session ThreadPort** et affiche son contexte sans lancer d'agent.

## Commandes

| Commande | Rôle |
| --- | --- |
| `init` | Initialise `.threadport/threadport.sqlite` dans le dossier courant. |
| `new "objectif"`, `sessions`, `open <id>`, `resume <id>` | Crée, liste et réactive les sessions. |
| `status`, `timeline`, `snapshot` | Affiche la situation, les événements et les métadonnées Git. |
| `decision "titre" [-r "raison"]`, `decisions` | Consigne et consulte les décisions. |
| `task add "titre"`, `task done <id>`, `task list` | Suit les tâches. |
| `note "texte"`, `error "titre" [-d "détails"]` | Consigne une information ou un problème. |
| `constraint "texte"`, `file <chemin>`, `files`, `artifact <chemin>` | Conserve les contraintes, fichiers pertinents et artefacts. |
| `test-result "nom" --status passed [-d "détails"]` | Enregistre un résultat de test ; utilisez `failed` en cas d'échec. |
| `check <exécutable> [arguments...]` | Exécute une commande sans shell, affiche sa sortie et conserve son résultat. |
| `command-log "commande" [-d "résultat"]` | Consigne une commande exécutée ailleurs. |
| `memory "texte"` | Ajoute une information durable, disponible aux autres sessions du projet. |
| `summary` | Produit un résumé déterministe des tâches, notes, décisions, tests, erreurs et de Git. |
| `search "termes"` | Recherche localement dans les sessions, décisions et enregistrements via SQLite FTS5. |
| `export <id> --out <fichier>`, `import <fichier>` | Transfère une session dans une archive JSON versionnée. |
| `context [--mode MODE] [--explain]` | Prévisualise le pack, ses sources, son budget et les chemins exclus. |
| `run <agent> [--structured]`, `switch <agent> [--structured]` | Lance un agent avec le contexte actif. |
| `continue <agent>` | Reprend une session native Claude ou Codex liée à un run structuré. |
| `agents`, `doctor` | Liste les agents et vérifie l'environnement. |
| `config show`, `config set-default-mode <mode>` | Affiche la configuration ou change le mode de contexte par défaut. |
| `tui`, `serve`, `mcp` | Ouvre le menu terminal, l'API locale ou le serveur MCP. |

Les agents intégrés sont `claude` et `codex`. `run` et `switch` utilisent le mode configuré (`standard` par défaut). `switch` enregistre un événement de transfert si l'agent précédent était différent. Les données d'une exécution restée ouverte après un crash sont marquées `interrupted` au prochain accès, sauf si son processus propriétaire est toujours vivant.

### Transférer une session entre installations

```bash
threadport sessions
threadport export abc12345 --out session.json
# Dans une autre copie du projet, après threadport init :
threadport import session.json
```

L'archive version 1 contient la session, les runs, événements, décisions, notes et snapshots Git. L'import crée de nouveaux identifiants et marque tout ancien run encore ouvert comme interrompu. Les worktrees et leurs chemins locaux ne sont pas transférés. Le fichier JSON peut contenir des informations sensibles du projet : conservez-le comme une donnée privée.

### Contexte

| Mode | Budget maximal | Sélection |
| --- | ---: | --- |
| `minimal` | 500 tokens | Objectif, informations prioritaires et quelques événements. |
| `standard` | 1 500 tokens | Résumé, mémoire, contraintes, tâches ouvertes, erreurs, décisions, tests, notes, fichiers pertinents, artefacts et état Git selon l'espace disponible. |
| `deep` | 4 000 tokens | Même base avec davantage d'événements et un diff Git filtré. |
| `full` | 10 000 tokens | Même sélection avec un budget supérieur. |

Le comptage utilise `cl100k_base` : c'est une **mesure de référence**, pas une garantie de taille identique pour tous les modèles. Le pack sélectionne les sections par priorité et indique celles qui n'ont pas tenu dans le budget avec `--explain`. Les résumés réduisent la quantité d'historique envoyée ; les événements d'origine restent dans SQLite.

`threadport config set-default-mode deep` choisit le mode utilisé par `run`, `switch`, le menu, l'API et MCP. La configuration du projet vit dans `.threadport/config.json`. Vous pouvez aussi y ajouter des exclusions :

```json
{
  "context": { "defaultMode": "standard" },
  "privacy": { "exclude": ["private/**"] }
}
```

## Expérimenter avec des forks

Les forks créent des [worktrees Git](https://git-scm.com/docs/git-worktree) à partir du **même commit**. Le dossier de départ doit être propre et posséder un commit `HEAD`. Les modifications non enregistrées ne sont jamais transférées automatiquement.

```bash
threadport fork --agents claude,codex
threadport fork list
threadport fork run <id-claude> --structured
threadport fork check <id-claude> npm test
threadport fork run <id-codex> --structured
threadport compare <id-claude> <id-codex>
threadport compare <id-claude> <id-codex> --diff
```

`compare` présente fichiers et lignes modifiés, durée, commandes, erreurs, tests et tokens enregistrés lorsque disponibles. Il ne désigne aucun gagnant. `fork remove <id>` retire seulement un worktree **propre** et conserve sa branche Git.

## Interfaces locales

- `threadport tui` : menu clavier pour consulter les sessions, le contexte, la timeline, les tâches et les runs ; ouvrir une session, rechercher, produire un résumé et gérer les notes et tâches.
- `threadport serve --port 0` : API HTTP liée à `127.0.0.1`. La commande affiche son URL et un jeton Bearer temporaire. Lectures : `/v1/status`, `/v1/sessions`, `/v1/context?mode=standard`, `/v1/timeline`, `/v1/decisions`, `/v1/records`, `/v1/runs`, `/v1/search?q=terme`. Écritures JSON : `POST /v1/sessions`, `/v1/sessions/open`, `/v1/tasks/complete`, `/v1/summary`, `/v1/notes`, `/v1/tasks`, `/v1/decisions`, `/v1/memory`. Les créations utilisent `title`, l'ouverture et la clôture utilisent `id`.
- `threadport mcp` : serveur MCP sur `stdio`. Les outils permettent de créer et d'ouvrir une session, lire le contexte, les événements, décisions, enregistrements et runs, rechercher, ajouter notes, tâches et décisions, terminer une tâche et produire un résumé. Le client MCP doit démarrer la commande avec la racine du projet comme dossier courant.

### Adapter d'agent local

Créez un manifest JSON, puis installez-le avec `threadport plugin add ./agent.json` :

```json
{
  "version": 1,
  "id": "my-agent",
  "label": "My Agent",
  "command": "my-agent",
  "args": ["Read {contextFile} and continue the current task."],
  "capabilities": ["filesystem_access", "git_access"]
}
```

Le manifest est copié dans `.threadport/plugins/` ; `threadport plugin list` affiche les agents ajoutés. Il s'agit d'un point d'extension pour **agents CLI**. Les plugins de stockage, d'export et de hooks ne sont pas encore disponibles.

## Stockage et confidentialité

La base, les manifests et les worktrees se trouvent sous `.threadport/` dans le projet. `init` ne modifie pas le `.gitignore` du projet : ajoutez-y `.threadport/` pour éviter de versionner ces données.

Les snapshots persistés conservent la branche, le commit et les chemins modifiés, **pas le contenu du diff**. Un diff peut entrer dans un contexte `deep` ou `full` et dans `compare --diff`. Les exclusions par défaut couvrent `.env`, `.env.*`, `*.pem`, `*.key`, `credentials.json`, `secrets/**` et `.threadport/**`. Ajoutez des motifs dans `.threadportignore`, un par ligne :

```gitignore
private/**
*.pem
```

ThreadPort masque plusieurs formats courants de secrets avant de conserver des notes ou de transmettre un pack, mais cette détection reste heuristique. Vérifiez `threadport context --explain` avant un transfert sensible. Les agents lancés appliquent leurs propres règles d'accès aux données. L'API exige un jeton et reste locale ; un client MCP connecté peut lire le contexte et ajouter des informations à la session.
