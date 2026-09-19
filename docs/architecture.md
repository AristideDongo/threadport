# Architecture ThreadPort 0.2

## Dépendances

`interfaces → application → domain`. `infrastructure` implémente les ports de l'application. La composition se fait dans la CLI ; les adapters fournisseur et Git ne sont jamais importés par le domaine.

## Persistance

Une base SQLite par projet vit dans `.threadport/threadport.sqlite`. `PRAGMA user_version` pilote les migrations jusqu'à la version 5. Les tables contiennent sessions, runs, événements, décisions, snapshots, enregistrements de travail, forks et un index FTS5. SQLite fonctionne en WAL avec un délai d'attente pour les écritures concurrentes. Les runs portent le PID du processus propriétaire, l'éventuel identifiant du fork et l'identifiant de session du fournisseur. Après un crash, seuls les runs dont le processus n'est plus vivant sont marqués interrompus. Les événements bruts restent disponibles après la production d'un résumé.

L'export JSON version 1 contient l'historique d'une session sans les chemins locaux de ses forks. L'import valide l'archive, remappe les identifiants et insère l'ensemble dans une transaction ; il laisse la base d'origine intacte.

## Collecte fournisseur

Le lancement interactif passe le pack par un fichier temporaire et laisse le terminal à l'agent. Le mode structuré lance `codex exec --json` ou `claude -p --output-format stream-json --verbose`, interprète les événements utiles et conserve les données normalisées, pas le flux brut. Les sorties fournisseur peuvent changer : leur conversion est isolée dans `structured-agent.ts`. Un run porte l'ID de session fournisseur lorsqu'il a été annoncé ; `continue` s'en sert pour une reprise native.

## Packs de contexte

Le pack contient objectif, dernier résumé, mémoire de projet, contraintes, tâches ouvertes, erreurs, décisions, tests, notes, fichiers pertinents, artefacts, état Git et événements récents. Un diff peut être ajouté en mode `deep` ou `full`. Chaque section indique sa provenance. Les budgets 500/1 500/4 000/10 000 sont mesurés avec `cl100k_base`, qui sert de référence entre fournisseurs. Les sections sont insérées par priorité ; celles qui dépassent le budget sont listées dans l'explication. Les chemins exclus par défaut, `.threadport/config.json` ou `.threadportignore` ne sont pas transmis ; la détection de secrets reste heuristique.

## Git, forks et comparaison

La lecture Git utilise `status --porcelain=v1 -z` pour les chemins particuliers. Les snapshots conservent les métadonnées, pas les diffs. Un fork exige un arbre de travail propre, crée une branche et un worktree à partir du même `HEAD`, et enregistre son lien avec la session. Les runs et tests faits dans un fork portent son ID. `compare` rapporte les mesures disponibles et peut afficher des diffs filtrés. `fork remove` refuse un worktree modifié et conserve la branche.

## Interfaces

La CLI, le menu TUI, l'API HTTP locale et MCP `stdio` utilisent les mêmes cas d'usage. L'API n'écoute que `127.0.0.1` et exige un jeton temporaire. API et MCP exposent lectures et écritures bornées pour notes, tâches et décisions. Les manifests de plugins ajoutent des adapters d'agents CLI validés à l'entrée.

## Risques et prochaines améliorations

La capture interactive détaillée dépendrait de hooks ou de protocoles fournisseur plus profonds. Une correspondance complète entre événements Claude et Codex exige des tests réels réguliers. Le compteur de tokens n'est pas exact pour tous les modèles. Les API/TUI et les types de plugins peuvent être étendus lorsque les flux de base auront davantage de tests de compatibilité et de résistance aux interruptions.
