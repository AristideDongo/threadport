# ThreadPort for VS Code

ThreadPort keeps a project-owned development session when work moves between AI coding agents. This first preview supports project initialization, persistent session creation and a multi-root aware Sessions view.

Open the ThreadPort Activity Bar view and select **New Session**. The project data stays locally in `.threadport/threadport.sqlite`.

## Development

From the repository root:

```bash
npm install
npm run check:extension
npm run build:extension
```

Open `apps/vscode-extension` in VS Code and press `F5`, or use the root launch configuration. The Extension Development Host displays the ThreadPort icon in the Activity Bar.
