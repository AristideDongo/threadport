# Changelog

All notable changes to the ThreadPort VS Code extension are documented here.

## 0.4.0 — 2026-09-24

- Respect Workspace Trust: agents, instructions and verification commands only run in trusted workspaces.
- Refresh automatically when the CLI, hooks or MCP change the project database.
- Keep unsent "Next instruction" drafts across window reloads.
- Apply the `threadport.context.mode` setting; it overrides the project default only when set.
- Stop blocking the editor: cache agent detection and Git state instead of reading them on every CodeLens refresh.
- Support project agent manifests trusted with `threadport plugin trust`.
- Start `.cmd` agent shims such as `claude.cmd` and `codex.cmd` on Windows.
- Review changes through the built-in Git extension, including large and renamed files.
- Add task checkboxes, rename, finish and delete session actions, and search.
- Add handoff drafting, GitHub issue and pull request links, and a privacy audit.
- Offer the ThreadPort MCP server to VS Code chat agents and add the `@threadport` chat participant.
- The status bar follows the active editor's folder and opens a quick menu.
- Add a ThreadPort output channel and a French translation.
- Reduce the package size from 2.5 MB to 1.1 MB.

## 0.3.0 — 2026-09-23

- Replace editable JSON sessions with native Markdown session workbenches.
- Add instruction execution and continuation through `Ctrl+Enter` or `Cmd+Enter`.
- Add agent start, stop, switch and interrupted-run recovery actions.
- Add context preview, project verification and native Git diff review.
- Add Explorer and editor actions for files and selected source code.
- Display Git changes, verification, decisions, runs and timeline events in the session document.

## 0.2.0 — 2026-09-22

- Add native editable session documents and CodeLens actions.
- Add Claude Code and Codex terminal-backed switching.

## 0.1.0 — 2026-09-22

- Add project initialization, persistent sessions and the Activity Bar session tree.
