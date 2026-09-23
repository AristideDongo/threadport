# ThreadPort for VS Code

[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/aristideghost.threadport-vscode?label=VS%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=aristideghost.threadport-vscode)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/aristideghost.threadport-vscode)](https://marketplace.visualstudio.com/items?itemName=aristideghost.threadport-vscode)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/AristideDongo/threadport/blob/main/LICENSE)

ThreadPort keeps a project-owned development session when work moves between AI coding agents. It supports project initialization, persistent sessions, native Markdown session documents, relevant files, decisions, run history, verification, Git review, and agent switching from the editor.

Open the ThreadPort Activity Bar view and select **New Session**. Session creation opens as an editable Markdown document in VS Code's native text editor. Edit the objective, select an optional agent, and save the document.

Expand a session and select **Agent**, **Relevant files**, **Decisions**, or **Runs**. ThreadPort opens the persistent session as a normal Markdown document and moves the cursor to the selected section.

Write work under **Next instruction**, then press `Ctrl+Enter` (`Cmd+Enter` on macOS) or select **Run instruction**. ThreadPort records the task and either starts the selected agent or sends the instruction to the agent terminal already running for the session. CodeLens actions can stop or switch agents, preview the context, run project verification, and open native Git diffs.

Use **ThreadPort: Add File to Context** from the Explorer or editor menu. Select source code and use **ThreadPort: Add Selection to Context** to record a precise line range and its contents. The session document displays current Git changes, verification state, relevant files, decisions, runs, and recent timeline events.

Project data stays locally in `.threadport/threadport.sqlite`. Context handoff files are temporary and removed after the agent terminal closes.

## Requirements

- VS Code 1.105 or newer.
- At least one supported agent installed in the workspace environment: Claude Code or Codex CLI.
- Git is recommended for snapshots and native change review.

ThreadPort detects agents in the same environment as the extension host, including WSL, SSH remotes and Dev Containers.

## Support

Report bugs and request features in the [ThreadPort issue tracker](https://github.com/AristideDongo/threadport/issues). See [SUPPORT.md](SUPPORT.md) for the information that helps diagnose a problem.

## Development

From the repository root:

```bash
npm install
npm run check:extension
npm run build:extension
```

Open `apps/vscode-extension` in VS Code and press `F5`, or use the root launch configuration. The Extension Development Host displays the ThreadPort icon in the Activity Bar.
