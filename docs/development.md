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

## Publier une version

Le workflow `ci.yml` vérifie les commits de `main` et les demandes de fusion. `publish.yml` publie uniquement un tag `vX.Y.Z` pointant vers un commit de `main` dont `package.json` porte la même version. La release passe les mêmes contrôles et vérifie que l'archive npm contient le CLI, sans `THREADPORT_PROJECT_PROMPT.md`.

Le package npm `threadport` doit autoriser un éditeur de confiance GitHub Actions avec le dépôt `AristideDongo/threadport`, le fichier `publish.yml` et l'action **npm publish**. La publication utilise OIDC et ne nécessite pas de secret `NPM_TOKEN`. Le dépôt GitHub est privé : npm ne génère pas de provenance pour ses releases.

```bash
npm version patch --no-git-tag-version
npm install --package-lock-only --ignore-scripts
npm run check && npm test && npm run build
git add package.json package-lock.json
git commit -m "Release $(node -p 'require("./package.json").version')"
git push origin main
git tag "v$(node -p 'require("./package.json").version')"
git push origin "v$(node -p 'require("./package.json").version')"
```

Attendre que le workflow de publication se termine avant de considérer la version disponible sur npm.
