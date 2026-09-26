<p align="center"><img src="apps/vscode-extension/media/threadport.png" width="96" height="96" alt="ThreadPort logo" /></p>

# ThreadPort

[![npm version](https://img.shields.io/npm/v/threadport.svg)](https://www.npmjs.com/package/threadport)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/aristideghost.threadport-vscode?label=VS%20Code)](https://marketplace.visualstudio.com/items?itemName=aristideghost.threadport-vscode)

> **The VS Code extension is available** on the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=aristideghost.threadport-vscode): `code --install-extension aristideghost.threadport-vscode`. It opens sessions as editable documents, tracks tasks, switches agents in a terminal, and shares the session with VS Code chat through MCP. Source: [`apps/vscode-extension`](apps/vscode-extension); design: [the extension design](docs/vscode-extension.md).

[![CI](https://github.com/AristideDongo/threadport/actions/workflows/ci.yml/badge.svg)](https://github.com/AristideDongo/threadport/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/AristideDongo/threadport?style=flat&logo=github)](https://github.com/AristideDongo/threadport/stargazers)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/AristideDongo/threadport/blob/main/LICENSE)

**One context. Any AI agent.**

[Website](https://threadport-io.vercel.app) · [Documentation](https://threadport-io.vercel.app/docs) · [npm](https://www.npmjs.com/package/threadport)

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

### Optional automatic handoffs

After `threadport init`, run `threadport hook install claude` or `threadport hook install codex` in your project. These project-local hooks provide the active context when an agent starts, record allowed file paths after edits, and write a summary when its session ends. They do not copy full conversations, tool arguments, or tool output. Codex asks you to review and trust new hooks with `/hooks` before running them.

Use `threadport doctor` to see installed agent versions. After upgrading an agent CLI, maintainers can run `npm run test:agents:live -- codex` or `npm run test:agents:live -- claude` from a source checkout with a configured account. This optional smoke test makes one small live request and checks the structured event format.

## Commands

| Command | Purpose |
| --- | --- |
| `init` | Initialize `.threadport/threadport.sqlite` in the current directory. Other commands also work from any subdirectory of the project. |
| `new "objective"`, `sessions`, `open <id>`, `resume <id>` | Create, list, and reactivate sessions. |
| `rename <id> "title"`, `finish <id>`, `delete <id>` | Rename, finish, or permanently delete a session. |
| `status`, `timeline`, `snapshot` | Show the current state, events, and Git metadata. |
| `decision "title" [-r "reason"]`, `decisions` | Record and review decisions. |
| `task add "title"`, `task done <id>`, `task list` | Track tasks. |
| `note "text"`, `error "title" [-d "details"]` | Record information or an issue. |
| `record edit <id> "title" [-d "details"]`, `record delete <id>` | Correct or remove a work record. |
| `constraint "text"`, `file <path>`, `files`, `artifact <path>` | Keep constraints, relevant files, and artifacts. |
| `test-result "name" --status passed [-d "details"]` | Record a test result; use `failed` for a failure. |
| `check <executable> [arguments...]` | Run a command without a shell, show its output, and save the result. |
| `command-log "command" [-d "result"]` | Record a command run elsewhere. |
| `memory "text"` | Add durable project knowledge available to other sessions. |
| `summary` | Build a deterministic summary of tasks, notes, decisions, tests, errors, and Git state. |
| `verify [executable] [args...]` | Run configured checks or one command and bind the results to the current Git state. |
| `handoff draft [-o file]`, `handoff save <file>`, `handoff show` | Draft, review, save, and inspect a cross-agent handoff. |
| `link issue <url>`, `link pr <url>` | Associate a session with a canonical GitHub issue or pull request. |
| `search "terms"` | Search sessions, decisions, and records locally with SQLite FTS5. |
| `export <id> --out <file>`, `import <file>` | Transfer a session in a versioned JSON archive. |
| `context [--mode MODE] [--explain]` | Preview the context pack, its sources, token budget, and excluded paths. |
| `run <agent> [--structured]`, `switch <agent> [--structured]` | Launch an agent with the active session context. |
| `continue <agent>` | Resume a linked native Claude or Codex session. |
| `agents`, `doctor` | List configured agents and check the local environment. |
| `config show`, `config set-default-mode <mode>` | View configuration or change the default context mode. |
| `tui`, `serve`, `mcp` | Open the terminal menu, local HTTP API, or MCP server. |
| `hook install claude`, `hook install codex` | Add optional local agent lifecycle hooks. |
| `privacy audit [--show-context]`, `privacy scrub`, `mcp setup` | Review sharing risks, clean stored data, or show MCP setup commands. |

Built-in agents are `claude` and `codex`. `run` and `switch` use the configured context mode (`standard` by default). `switch` records a handoff event when the previous run used a different agent. If a process crashes, an unfinished run is marked `interrupted` on the next access unless its owner process is still running.

### Verify and review a handoff

`verify` detects `check`, `test`, and `build` scripts in a Node project. For another project, set explicit commands in `.threadport/config.json`. Commands run in order without a shell. A successful report applies only while the Git state remains the same; a changed file makes the report stale. A project without Git can run checks, but ThreadPort cannot mark them as verified against a Git state.

```json
{
  "verification": {
    "commands": [
      { "command": "cargo", "args": ["test"] },
      { "command": "cargo", "args": ["clippy", "--", "-D", "warnings"] }
    ]
  }
}
```

Link work, verify it, and edit a draft before saving it:

```bash
threadport link issue https://github.com/owner/repo/issues/42
threadport verify
threadport privacy audit --show-context
threadport handoff draft --out .threadport/handoff.md
# Review and edit .threadport/handoff.md in your editor.
threadport handoff save .threadport/handoff.md
threadport handoff show
```

Keep the draft under `.threadport/` or outside the repository so writing it does not change the Git state being verified. A saved handoff retains its Git fingerprint; ThreadPort warns when code or recorded work changes afterward. Handoffs include record IDs and clearly mark missing or stale verification. Interactive provider reasoning remains unavailable unless the provider exposes it.

### Transfer a session between installations

```bash
threadport sessions
threadport export abc12345 --out session.json
# In another copy of the project, after threadport init:
threadport import session.json
```

Version 2 archives include the session, runs, events, decisions, records, verification reports, saved handoffs, links, and Git snapshots. ThreadPort also imports version 1 archives. Import assigns new IDs and marks any previously open run as interrupted. Worktrees and local paths are not transferred. The JSON file may contain sensitive project information; handle it as private data.

Exports and imports apply current path exclusions and secret redaction. For data recorded before a privacy rule was added, run `threadport privacy scrub` to clean the local database and rebuild its search index. The command cannot recall archives already shared elsewhere.

### Context

| Mode | Maximum budget | Selection |
| --- | ---: | --- |
| `minimal` | 500 tokens | Objective, high-priority information, and a few events. |
| `standard` | 1,500 tokens | Summary, memory, constraints, open tasks, errors, decisions, tests, notes, relevant files, artifacts, and Git state as space allows. |
| `deep` | 4,000 tokens | The same foundation, with more events and a filtered Git diff. |
| `full` | 10,000 tokens | The same selection with a larger budget. |

Token counts use `cl100k_base` as a **reference measure**; they are not guaranteed to match every model's tokenizer. Sections are selected by priority. `--explain` shows which sections did not fit. Summaries reduce the history sent to an agent; the original events remain in SQLite.

Open tasks and current errors are considered before older notes. Large sections are included item by item or truncated to fit. Saved handoffs, linked work, and verification status are included as space allows. ThreadPort warns when a summary or handoff may be stale.

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

- `threadport tui`: keyboard menu for sessions, context, tasks, verification, privacy audit, linked work, and handoff review.
- `threadport serve --port 0`: HTTP API bound to `127.0.0.1`. The command prints its URL and a temporary Bearer token. Read endpoints include `/v1/handoff/draft`, `/v1/handoff`, `/v1/verification`, and `/v1/privacy/audit`. `POST /v1/handoff` accepts `{ "content": "..." }`; `POST /v1/links` accepts `{ "kind": "issue", "url": "https://github.com/owner/repo/issues/42" }`. The API does not execute verification commands.
- `threadport mcp`: MCP server over `stdio`. It exposes context and saved-handoff resources, a continuation prompt, and tools for sessions, records, handoff review, linked work, verification status, and privacy audit. Run `threadport mcp setup` for client registration commands. Start the MCP client with the project root as its working directory.

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

The manifest is copied to `.threadport/plugins/` and trusted for your user account; `threadport plugin list` shows installed agents. ThreadPort refuses to run a manifest it finds in the project without that step, for example one that came with a cloned repository, and `doctor` does not execute it. Review the manifest, then run `threadport plugin trust <id>`. Trust is stored in `~/.threadport/trusted-agents.json` (or `$THREADPORT_HOME`) and is revoked when the manifest changes. This extension point supports **CLI agents**. External storage, export, and hook plugins are not yet available.

## Storage and privacy

The database, agent manifests, and worktrees live under `.threadport/` in the project. ThreadPort writes `.threadport/.gitignore` so Git ignores this local data; it does not edit the project's own `.gitignore`.

Stored snapshots contain the branch, commit, and changed file paths, **not the diff contents**. A diff may appear in `deep` or `full` context and in `compare --diff`. Default exclusions cover `.env`, `.env.*`, `*.pem`, `*.key`, `credentials.json`, `secrets/**`, and `.threadport/**`. Add one pattern per line to `.threadportignore`:

```gitignore
private/**
*.pem
```

ThreadPort filters excluded file references from new snapshots, hooks, and session archives. It redacts common secret formats (OpenAI/Anthropic, GitHub, GitLab, npm, Stripe, AWS, Google, and Slack keys, JWTs, Bearer headers, URL credentials, private keys, and `token=`/`password:` assignments) before storing notes and events or sending a context pack; detection is heuristic. `threadport privacy audit` counts fields that still match the redaction rules and excluded references without printing their values. Review the context and an export file before sharing. Launched agents apply their own data access rules. The API requires a token and stays local; a connected MCP client can read context and add session information.

## Contributing

Issues and pull requests are welcome. See [Contributing](https://github.com/AristideDongo/threadport/blob/main/CONTRIBUTING.md) for the development setup and review process, and the [Code of Conduct](https://github.com/AristideDongo/threadport/blob/main/CODE_OF_CONDUCT.md) for community expectations. Browse [open issues](https://github.com/AristideDongo/threadport/issues) or [star the project](https://github.com/AristideDongo/threadport/stargazers) if ThreadPort helps your workflow.

The [developer research plan](https://github.com/AristideDongo/threadport/blob/main/docs/research.md) lists the workflow questions and measures we want to test with users. It does not present interviews as completed work.

## License

ThreadPort is available under the [MIT License](https://github.com/AristideDongo/threadport/blob/main/LICENSE).
