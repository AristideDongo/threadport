# ThreadPort

**One context. Any AI agent.** MVP local pour suivre une tâche et transmettre son contexte entre Claude Code et Codex.

## Installation

Node.js 24 ou plus récent est requis.

```bash
npm install
npm run build
npm link
```

## Premier parcours

```bash
cd mon-projet
threadport init
threadport new "Implémenter l'authentification"
threadport decision "Utiliser Redis pour les jetons" --rationale "Révocation partagée"
threadport context
threadport run claude
threadport switch codex
threadport status
threadport timeline
threadport sessions
threadport resume <id>
```

`run` et `switch` ouvrent l'agent dans le terminal courant. Le fichier de contexte temporaire est supprimé à la fin. `context --mode minimal|standard|deep|full` permet de voir le pack avant de le transmettre. `snapshot` capture les métadonnées Git sans enregistrer le diff. `doctor` vérifie l'environnement et `agents` liste les agents connus.

Les données du projet restent dans `.threadport/`, ignoré par Git. Ajoutez des motifs de chemin à `.threadportignore` (un par ligne) pour exclure des fichiers du contexte. Les motifs par défaut couvrent `.env`, les clés et `secrets/`. Le contexte contient des décisions saisies explicitement et des événements ThreadPort; les conversations internes des agents ne sont pas importées.

## Développement

```bash
npm run check
npm test
npm run build
npm run dev -- --help
```

Voir [l'architecture](docs/architecture.md) pour le modèle, les limites et la feuille de route.
