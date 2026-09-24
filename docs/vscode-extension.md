# VS Code extension design

## Scope

The VS Code extension is another interface to the existing ThreadPort engine. It does not maintain a second session model and does not invoke the CLI to perform application operations. The implemented slices cover project discovery, initialization, session creation, SQLite persistence, the Activity Bar view, native editable session documents, relevant files, decisions, run history, and terminal-backed agent switching.

## Repository layout

```text
src/domain/                         Existing provider-neutral model
src/application/                    Existing use cases and ports
src/infrastructure/                 Existing SQLite, Git and agent adapters
src/interfaces/                     Existing CLI, TUI, API and MCP
apps/vscode-extension/
  src/bootstrap/                    Lazy composition root
  src/commands/                     VS Code command handlers
  src/views/                        Tree data providers
  src/vscode-adapters/              Workspace and presentation adapters
  src/extension.ts                  Lightweight activation boundary
  media/                            Activity Bar assets
```

## Existing core model

The current `Session` remains the first aggregate. `AgentRun`, decisions, snapshots, work records and forks are persisted entities associated with a session. Identifiers, titles, statuses, agent IDs, context modes, timestamps, Git state and record kinds remain domain values. Existing events such as `SessionCreated`, `SessionOpened`, `AgentRunStarted`, `AgentSwitched`, `ContextSnapshotCreated` and `AgentRunStopped` form the universal timeline.

The extension calls the existing `ThreadPort` use cases. `SessionStore`, `GitReader`, `AgentRunner`, `AgentAdapter`, `CommandExecutor` and `WorktreeManager` remain the application ports. VS Code specific behavior stays in adapters and command handlers.

## Persistence and projects

Each workspace folder is an explicit ThreadPort project and owns `.threadport/threadport.sqlite`. A multi-root workspace can therefore display several projects without assuming that the workspace is a single repository. The extension stores no API keys in SQLite. Future credentials must use `ExtensionContext.secrets`.

The extension host runs where the workspace is located for SSH, WSL and Dev Containers. Filesystem operations use the workspace folder URI converted by the VS Code host. Virtual filesystems that do not expose a local extension-host path are reported as unsupported instead of being treated as local paths.

## Agent adapter protocol

Each agent adapter continues to provide a stable ID, display label, executable name and argument builder. Detection and launching go through `AgentRunner`; commands are never scattered through UI code. Future capability and structured event parsing additions belong to the adapter boundary, with fixture tests for each supported CLI version.

## Context pack

The existing context pack is the canonical provider-neutral format. It contains sourced sections for the objective, summaries, memory, constraints, tasks, errors, decisions, tests, notes, relevant files, artifacts, Git state and recent events. Token budgeting, exclusions, redaction and provider mapping happen before transmission. Context preview will render this pack without silently adding open files.

## Agent run lifecycle and recovery

Runs move from `running` to `completed`, `failed`, `cancelled` or `interrupted`. They carry an owner process ID, timestamps, exit code, optional provider session ID and optional fork ID. On lazy project startup, `ThreadPort.recover()` marks abandoned runs interrupted only when their owner process no longer exists. A later recovery view will allow inspection before a new run starts.

## VS Code integration

- Activation registers commands, the Tree View and the status item without opening databases.
- The composition root creates a project runtime only when a project is expanded or a command needs it.
- The Tree View renders project folders and their persisted sessions. Its detail items open a `threadport:` Markdown document in VS Code's native text editor and reveal the matching section.
- `New Session` opens a native editable Markdown document. Saving it creates the session through the existing application layer.
- Session actions use application methods and refresh presentation state afterward.
- CodeLens actions apply document changes, run the next instruction, stop or switch agents, preview context, execute configured verification commands, and review Git changes through VS Code's native diff editor.
- Explorer and editor context actions add a file or the current selection to the active session context.
- Agent switching builds a current context pack, starts the selected adapter in a VS Code terminal and records the run lifecycle.
- Invalid editable session documents are reported through native VS Code diagnostics.
- A file system watcher on `.threadport/threadport.sqlite*` refreshes the tree, status item and open documents when the CLI, hooks or MCP change the database (debounced by 300 ms).
- Git state is read through a short-lived cache (3 s, cleared on save and on ThreadPort changes), and agent availability is cached until **Refresh**, so CodeLens and document refreshes do not block the extension host.
- Unsent "Next instruction" drafts are kept in workspace state and survive a window reload.
- The Tree View shows tasks with checkboxes, and session context menus rename, finish or delete a session.
- Project agent manifests are offered when the user trusted them with `threadport plugin trust`; untrusted manifests are never probed or run.
- `threadport.context.mode` overrides the project default from `.threadport/config.json` only when set explicitly.
- `dist/mcp-server.js` is registered through `lm.registerMcpServerDefinitionProvider`, one server per initialized folder, and runs with VS Code's own runtime (`ELECTRON_RUN_AS_NODE`).
- The `@threadport` chat participant answers from the active session; `/context` and `/handoff` print the context pack and a handoff draft.
- Workspace Trust: in Restricted Mode sessions stay readable and editable, but agents, instructions and verification commands are refused.
- Messages are localized with `vscode.l10n` (`l10n/bundle.l10n.fr.json`, `package.nls.fr.json`). A unit test fails when a new string lacks a French translation.
- Errors are logged with their stack in the **ThreadPort** output channel (`ThreadPort: Show Logs`).

## Platform and provider limits

- VS Code does not expose arbitrary integrated-terminal history. Detailed activity requires structured agent output or lifecycle hooks.
- Agent output formats and resume flags are external contracts and require regular live smoke tests.
- Virtual workspaces may not support Node SQLite or process execution.
- Token counts are estimates across providers.
- Secret detection is heuristic, so preview remains part of the handoff flow.

## Incremental plan

1. Activation, multi-root discovery, initialization, session creation, persistence and Sidebar.
2. [Complete] Claude Code and Codex detection, terminal adapters and `AgentRun` lifecycle.
3. [Complete] Git capture, explicit context preview and verified Claude-to-Codex switching.
4. [Complete] Relevant files, decisions, tasks, timeline, recovery controls, MCP and chat integration.
5. Worktree forks, comparisons and native VS Code diffs.
6. [In progress] Gemini, OpenCode, marketplace packaging and compatibility automation. CI runs the extension in VS Code 1.105 (minimum engine) and the current stable release.

Every slice must pass TypeScript checking, tests, build and package-content validation.
