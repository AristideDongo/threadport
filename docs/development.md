# Développement de ThreadPort

## Architecture

```text
src/domain/             Types et règles du modèle universel
src/application/        Cas d'usage et ports
src/infrastructure/     SQLite, Git, agents, commandes et confidentialité
src/interfaces/         CLI, TUI, API et MCP
```

Le domaine ne dépend d'aucun fournisseur. Les migrations SQLite sont versionnées et la recherche utilise FTS5. Voir [architecture.md](architecture.md) pour les choix techniques.

## Installation depuis les sources

```bash
npm install
npm run build
npm link
threadport --help
```

Après une modification, relancer `npm run build`. Pour travailler directement en TypeScript : `npm run dev -- --help`.

## Vérifications

```bash
npm run check
npm test
npm run build
npm audit --audit-level=moderate
```

Les tests couvrent les flux locaux et les formats structurés simulés. Une vérification avec un vrai service Claude ou Codex requiert l'agent installé, un compte configuré et une exécution volontaire ; les formats des fournisseurs peuvent évoluer.

## Frontières de collecte

Le mode interactif confie le terminal à l'agent et ne voit pas les conversations que cet agent ne publie pas. Le mode `--structured` normalise les événements JSON disponibles. Un résumé ne peut décrire que les données conservées ; il ne reconstitue pas un raisonnement privé absent. Les données du projet restent locales, sauf lorsqu'un agent lancé les transmet selon ses propres règles.

Les manifests de plugins configurent actuellement des agents CLI. Le stockage, l'export et les hooks restent des points d'extension internes et n'acceptent pas encore de plugins externes.
