# ThreadPort architecture

## Dependencies

`interfaces → application → domain`. Infrastructure implements application ports. The CLI assembles the components. Provider adapters and Git integration are never imported by the domain layer.

## Persistence

Each project keeps a SQLite database at `.threadport/threadport.sqlite`. `PRAGMA user_version` manages migrations through schema version 5. Tables store sessions, runs, events, decisions, snapshots, work records, forks, and an FTS5 search index. SQLite uses WAL mode and a busy timeout for concurrent writes. Runs store the owner process ID, optional fork ID, and provider session ID. After a crash, only runs whose owner process is no longer alive are marked interrupted. Original events remain available after a summary is created.

Version 1 JSON exports contain a session's history without local fork paths. Import validates the archive, remaps IDs, and inserts the data in a transaction; it does not change the source database.

## Provider event capture

Interactive launching passes the context pack through a temporary file and gives the terminal to the agent. Structured mode runs `codex exec --json` or `claude -p --output-format stream-json --verbose`, interprets useful events, and stores normalized data rather than the raw stream. Provider formats may change; their conversion is isolated in `structured-agent.ts`. A run stores the provider session ID when the provider announces it, and `continue` uses that ID for native resumption.

## Context packs

A pack can contain the objective, latest summary, project memory, constraints, open tasks, errors, decisions, tests, notes, relevant files, artifacts, Git state, and recent events. A diff can be included in `deep` or `full` mode. Each section identifies its source. Budgets of 500, 1,500, 4,000, and 10,000 tokens are measured with `cl100k_base`, a reference measure across providers. Sections are added by priority; the explanation lists sections that did not fit. Default exclusions, `.threadport/config.json`, and `.threadportignore` keep selected paths out of the pack. Secret detection remains heuristic.

## Git, forks, and comparison

Git status uses `status --porcelain=v1 -z` to handle unusual paths. Snapshots store metadata rather than diffs. Creating a fork requires a clean worktree, creates a branch and worktree from the same `HEAD`, and links it to the session. Runs and tests inside a fork carry its ID. `compare` reports available measurements and can display filtered diffs. `fork remove` refuses a modified worktree and keeps its branch.

## Interfaces

The CLI, terminal menu, local HTTP API, and MCP `stdio` server use the same application use cases. The API listens only on `127.0.0.1` and requires a temporary token. API and MCP expose sessions, runs, notes, tasks, decisions, and summaries. Plugin manifests add validated CLI agent adapters.

## Current boundaries

Detailed interactive capture would require deeper provider hooks or protocols. Complete mapping of Claude and Codex events requires regular live compatibility checks. Token counts are not exact for every model. API, terminal menu, and plugin types can be expanded as compatibility and interruption handling gain further coverage.
