# ThreadPort for VS Code

ThreadPort keeps a project-owned development session when work moves between AI coding agents. The preview supports project initialization, persistent sessions, readable session pages, relevant files, decisions, run history, and agent switching from the editor.

Open the ThreadPort Activity Bar view and select **New Session**. Session creation opens in an editor page. Expand a session and select **Agent**, **Relevant files**, **Decisions**, or **Runs** to open the corresponding page. Switching to an installed agent creates a current context pack and starts the agent in a VS Code terminal.

Project data stays locally in `.threadport/threadport.sqlite`. Context handoff files are temporary and removed after the agent terminal closes.

## Development

From the repository root:

```bash
npm install
npm run check:extension
npm run build:extension
```

Open `apps/vscode-extension` in VS Code and press `F5`, or use the root launch configuration. The Extension Development Host displays the ThreadPort icon in the Activity Bar.
