# VS Code extension design

## Scope

The VS Code extension is another interface to the existing ThreadPort engine. It does not maintain a second session model and does not invoke the CLI to perform application operations. The implemented slices cover project discovery, initialization, session creation, SQLite persistence, the Activity Bar view, readable session pages, relevant files, decisions, run history, and terminal-backed agent switching.

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
- The Tree View renders project folders and their persisted sessions. Its detail items open the matching editor page.
- `New Session` opens an editor form for the project, objective and optional initial agent.
- Session actions use application methods and refresh presentation state afterward.
- Agent switching builds a current context pack, starts the selected adapter in a VS Code terminal and records the run lifecycle.
- Context preview and diagnostics collectors arrive in later vertical slices.

## Platform and provider limits

- VS Code does not expose arbitrary integrated-terminal history. Detailed activity requires structured agent output or lifecycle hooks.
- Agent output formats and resume flags are external contracts and require regular live smoke tests.
- Virtual workspaces may not support Node SQLite or process execution.
- Token counts are estimates across providers.
- Secret detection is heuristic, so preview remains part of the handoff flow.

## Incremental plan

1. Activation, multi-root discovery, initialization, session creation, persistence and Sidebar.
2. [In progress] Claude Code and Codex detection, terminal adapters and `AgentRun` lifecycle.
3. Git capture, explicit context preview and verified Claude-to-Codex switching.
4. Relevant files, decisions, timeline and recovery controls.
5. Worktree forks, comparisons and native VS Code diffs.
6. Gemini, OpenCode, marketplace packaging and compatibility automation.

Every slice must pass TypeScript checking, tests, build and package-content validation.
