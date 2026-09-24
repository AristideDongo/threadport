# Developing ThreadPort

## Architecture

```text
src/domain/             Core model types and rules
src/application/        Use cases and ports
src/infrastructure/     SQLite, Git, agents, commands, and privacy
src/interfaces/         CLI, terminal menu, API, and MCP
```

The domain does not depend on any provider. SQLite migrations are versioned and search uses FTS5. See [architecture.md](architecture.md) for design decisions.

## Install from source

```bash
npm install
npm run build
npm link
threadport --help
```

Run `npm run build` after code changes. To work directly with TypeScript, use `npm run dev -- --help`.

## Checks

```bash
npm run check          # TypeScript, Biome lint, architecture boundaries
npm test
npm run test:coverage  # V8 coverage for src/, as run on Linux CI
npm run build
npm audit --audit-level=moderate
```

CLI commands live in `src/interfaces/cli/commands/`, grouped by area; `runtime.ts` holds the shared project lookup and helpers. `main.ts` only hides the `node:sqlite` experimental warning before loading `program.ts`.

CI runs these checks on Linux, macOS, and Windows. It keeps a stable `verify` status for branch protection. A maintainer with configured agent accounts can also run `npm run test:agents:live -- claude` or `npm run test:agents:live -- codex`; this makes a small live request to catch provider JSON format changes.

Tests cover local workflows and simulated structured provider formats. A live Claude or Codex check requires an installed agent, a configured account, and an intentional run. Provider formats may evolve.

Product hypotheses, interview tasks, and success measures are in [research.md](research.md). The plan does not claim that interviews have already been conducted.

## Capture boundaries

Interactive mode gives the terminal to the agent and cannot see conversations the agent does not expose. `--structured` normalizes available JSON events. A summary can describe only stored data; it cannot reconstruct private reasoning that was never captured. Project data stays local unless a launched agent transmits it under its own rules.

Plugin manifests currently configure CLI agents. Storage, export, and hooks are internal extension points and do not yet accept external plugins.

## Publish a version

The `ci.yml` workflow checks commits on `main` and pull requests. `publish.yml` publishes only a `vX.Y.Z` tag pointing to a commit on `main` whose `package.json` has the same version. The release runs the same checks and verifies that the npm archive contains the CLI but excludes `THREADPORT_PROJECT_PROMPT.md`.

The `threadport` npm package must trust GitHub Actions for repository `AristideDongo/threadport`, workflow file `publish.yml`, and the **npm publish** action. Publishing uses OIDC and needs no `NPM_TOKEN` secret. The public repository allows npm provenance to link a package release to its source commit and workflow.

```bash
git switch -c release/threadport-version
npm version patch --no-git-tag-version
npm install --package-lock-only --ignore-scripts
npm run check && npm test && npm run build
git add package.json package-lock.json
git commit -m "Release $(node -p 'require("./package.json").version')"
git push origin HEAD:release/threadport-version
# Open a pull request from release/threadport-version to main and merge it after CI passes.
git switch main
git pull --ff-only origin main
git tag "v$(node -p 'require("./package.json").version')"
git push origin "v$(node -p 'require("./package.json").version')"
```

Wait for the publication workflow to finish before treating the version as available on npm.
