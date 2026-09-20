# ThreadPort

**One context. Any AI agent.**

ThreadPort keeps development task context in your project and carries it between Claude Code, Codex, and locally configured agents. Each session tracks a timeline, decisions, tasks, notes, test results, agent runs, and Git snapshots. Data is stored in a local SQLite database.

The handoff includes information recorded in the session and events exposed by agents in structured mode.

## Installation

Requirements: **Node.js 24+** and npm. Git features require a Git repository. Install Claude Code and/or Codex CLI on your `PATH` to launch those agents.

```bash
npm install --global threadport
threadport --help
```

## Quick start: Claude → Codex

Run these commands from the **root of the project you want to track**:

```bash
threadport init
threadport new "Fix token rotation"
threadport task add "Write a concurrency test"
threadport decision "Keep token IDs in Redis" -r "Shared revocation"
threadport context --explain
threadport run claude
```

After Claude exits, you can record work that its interactive interface did not expose to ThreadPort:

```bash
threadport note "The collision happens during simultaneous renewal"
threadport check npm test
threadport summary
threadport switch codex
```

For **structured event capture**, use `--structured`. This runs the agent without its interactive interface and records commands, messages, errors, and provider session IDs available in its JSON stream:

```bash
threadport run codex --structured
threadport status
threadport continue codex
```

`continue` resumes a native provider session if its ID was captured during a structured run. `threadport resume <id>` instead activates a **ThreadPort session** and prints its context without launching an agent.

## Commands

| Command | Purpose |
| --- | --- |
| `init` | Initialize `.threadport/threadport.sqlite` in the current directory. |
| `new "objective"`, `sessions`, `open <id>`, `resume <id>` | Create, list, and reactivate sessions. |
| `status`, `timeline`, `snapshot` | Show the current state, events, and Git metadata. |
| `decision "title" [-r "reason"]`, `decisions` | Record and review decisions. |
| `task add "title"`, `task done <id>`, `task list` | Track tasks. |
| `note "text"`, `error "title" [-d "details"]` | Record information or an issue. |
| `constraint "text"`, `file <path>`, `files`, `artifact <path>` | Keep constraints, relevant files, and artifacts. |
| `test-result "name" --status passed [-d "details"]` | Record a test result; use `failed` for a failure. |
| `check <executable> [arguments...]` | Run a command without a shell, show its output, and save the result. |
| `command-log "command" [-d "result"]` | Record a command run elsewhere. |
| `memory "text"` | Add durable project knowledge available to other sessions. |
| `summary` | Build a deterministic summary of tasks, notes, decisions, tests, errors, and Git state. |
| `search "terms"` | Search sessions, decisions, and records locally with SQLite FTS5. |
| `export <id> --out <file>`, `import <file>` | Transfer a session in a versioned JSON archive. |
| `context [--mode MODE] [--explain]` | Preview the context pack, its sources, token budget, and excluded paths. |
| `run <agent> [--structured]`, `switch <agent> [--structured]` | Launch an agent with the active session context. |
| `continue <agent>` | Resume a linked native Claude or Codex session. |
| `agents`, `doctor` | List configured agents and check the local environment. |
| `config show`, `config set-default-mode <mode>` | View configuration or change the default context mode. |
| `tui`, `serve`, `mcp` | Open the terminal menu, local HTTP API, or MCP server. |

Built-in agents are `claude` and `codex`. `run` and `switch` use the configured context mode (`standard` by default). `switch` records a handoff event when the previous run used a different agent. If a process crashes, an unfinished run is marked `interrupted` on the next access unless its owner process is still running.

### Transfer a session between installations

```bash
threadport sessions
threadport export abc12345 --out session.json
# In another copy of the project, after threadport init:
threadport import session.json
```

Version 1 archives include the session, runs, events, decisions, records, and Git snapshots. Import assigns new IDs and marks any previously open run as interrupted. Worktrees and local paths are not transferred. The JSON file may contain sensitive project information; handle it as private data.

### Context

| Mode | Maximum budget | Selection |
| --- | ---: | --- |
| `minimal` | 500 tokens | Objective, high-priority information, and a few events. |
| `standard` | 1,500 tokens | Summary, memory, constraints, open tasks, errors, decisions, tests, notes, relevant files, artifacts, and Git state as space allows. |
| `deep` | 4,000 tokens | The same foundation, with more events and a filtered Git diff. |
| `full` | 10,000 tokens | The same selection with a larger budget. |

Token counts use `cl100k_base` as a **reference measure**; they are not guaranteed to match every model's tokenizer. Sections are selected by priority. `--explain` shows which sections did not fit. Summaries reduce the history sent to an agent; the original events remain in SQLite.

`threadport config set-default-mode deep` selects the mode used by `run`, `switch`, the terminal menu, the API, and MCP. Project configuration lives in `.threadport/config.json`, where you can also add exclusions:

```json
{
  "context": { "defaultMode": "standard" },
  "privacy": { "exclude": ["private/**"] }
}
```

## Experiment with forks

Forks create [Git worktrees](https://git-scm.com/docs/git-worktree) from the **same commit**. The starting worktree must be clean and have a `HEAD` commit. Uncommitted changes are not copied automatically.

```bash
threadport fork --agents claude,codex
threadport fork list
threadport fork run <claude-fork-id> --structured
threadport fork check <claude-fork-id> npm test
threadport fork run <codex-fork-id> --structured
threadport compare <claude-fork-id> <codex-fork-id>
threadport compare <claude-fork-id> <codex-fork-id> --diff
```

`compare` reports changed files and lines, duration, commands, errors, tests, and recorded tokens when available. It does not choose a winner. `fork remove <id>` removes only a **clean** worktree and keeps its Git branch.

## Local interfaces

- `threadport tui`: keyboard menu for sessions, context, timeline, tasks, and runs; you can open a session, search, write a summary, and manage notes and tasks.
- `threadport serve --port 0`: HTTP API bound to `127.0.0.1`. The command prints its URL and a temporary Bearer token. Read endpoints: `/v1/status`, `/v1/sessions`, `/v1/context?mode=standard`, `/v1/timeline`, `/v1/decisions`, `/v1/records`, `/v1/runs`, `/v1/search?q=term`. JSON write endpoints: `POST /v1/sessions`, `/v1/sessions/open`, `/v1/tasks/complete`, `/v1/summary`, `/v1/notes`, `/v1/tasks`, `/v1/decisions`, and `/v1/memory`. Creation requests use `title`; opening a session and completing a task use `id`.
- `threadport mcp`: MCP server over `stdio`. Tools create and open sessions; read context, events, decisions, records, and runs; search; add notes, tasks, and decisions; complete tasks; and write summaries. Start the MCP client with the project root as its working directory.

### Local agent adapter

Create a JSON manifest and install it with `threadport plugin add ./agent.json`:

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

The manifest is copied to `.threadport/plugins/`; `threadport plugin list` shows installed agents. This extension point supports **CLI agents**. External storage, export, and hook plugins are not yet available.

## Storage and privacy

The database, agent manifests, and worktrees live under `.threadport/` in the project. `init` does not edit the project's `.gitignore`; add `.threadport/` there to avoid committing local data.

Stored snapshots contain the branch, commit, and changed file paths, **not the diff contents**. A diff may appear in `deep` or `full` context and in `compare --diff`. Default exclusions cover `.env`, `.env.*`, `*.pem`, `*.key`, `credentials.json`, `secrets/**`, and `.threadport/**`. Add one pattern per line to `.threadportignore`:

```gitignore
private/**
*.pem
```

ThreadPort redacts several common secret formats before storing notes or sending a context pack, but detection is heuristic. Review `threadport context --explain` before a sensitive handoff. Launched agents apply their own data access rules. The API requires a token and stays local; a connected MCP client can read context and add session information.
