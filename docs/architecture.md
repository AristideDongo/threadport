# Architecture du MVP

## Portée et choix

Le premier flux utilisable est `init → new → run claude → switch codex → resume → timeline`. TypeScript strict, Node 24, Commander pour la CLI et `node:sqlite` pour SQLite. Le module SQLite de Node évite une dépendance native supplémentaire; la version de Node est donc une contrainte explicite. Vitest teste le domaine et les flux. Le TUI, les forks et la comparaison sont reportés après validation de ce flux.

## Dépendances

`interfaces/cli → application → domain`. `infrastructure` implémente les ports définis dans `application`. Le domaine ne contient ni nom de fournisseur ni import de stockage, terminal ou Git. La composition des dépendances se fait dans la CLI.

## Données

Une base SQLite par projet vit dans `.threadport/threadport.sqlite`. Le schéma versionné par `PRAGMA user_version` contient `sessions`, `runs`, `events`, `decisions` et `snapshots`. Les événements sont append-only; les sessions et runs gardent leur état courant pour une lecture rapide. Le schéma est versionné; les snapshots Git JSON sont validés à la lecture. Un ancien run marqué actif après un crash est clos au prochain lancement avec `interrupted`.

## Adapters et capture

Un adapter déclare son identifiant, son exécutable, ses capacités et construit ses arguments. La CLI garde le terminal connecté à l'agent et attend son code de sortie. ThreadPort enregistre l'heure, l'agent et les métadonnées Git avant et après (sans conserver le contenu des diffs), mais ne prétend pas lire les conversations privées ni les appels d'outils internes. L'arrêt brutal du processus parent peut laisser un run ouvert; la récupération le marque interrompu au prochain accès.

## Contexte et confidentialité

Le pack contient objectif, contraintes, décisions, événements récents et état Git. Les modes `minimal`, `standard`, `deep`, `full` augmentent progressivement le budget de caractères. Le texte est passé à l'agent via un fichier temporaire à permissions restrictives, puis supprimé. Les chemins sensibles et les lignes ressemblant à des secrets sont exclus du pack. `.threadportignore` ajoute des motifs simples de type glob. Le diff Git est plafonné avant assemblage et les valeurs sensibles sont masquées. Il reste prudent de revoir un pack avec `threadport context` avant transmission.

## Git et évolution

L'adapter Git est en lecture seule et n'exécute ni commit ni reset. Si le dossier n'est pas un dépôt, l'état Git est absent et les autres commandes fonctionnent. Les forks devront utiliser des worktrees explicites, avec contrôle des modifications non enregistrées. La recherche, la compression et le TUI pourront lire les mêmes ports sans déplacer la logique métier.

## Risques et feuille de route

Le contenu conversationnel n'est pas capturé automatiquement; les décisions et notes de passation sont saisies explicitement. Certains CLI fournisseurs changent leurs options, d'où leur isolation dans les adapters. La prochaine étape est la capture explicite de notes, tests et erreurs; viennent ensuite forks isolés, comparaison, recherche et TUI.
