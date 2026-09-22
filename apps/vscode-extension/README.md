# ThreadPort for VS Code

ThreadPort keeps a project-owned development session when work moves between AI coding agents. The preview supports project initialization, persistent sessions, native session documents, relevant files, decisions, run history, and agent switching from the editor.

Open the ThreadPort Activity Bar view and select **New Session**. Session creation opens as an editable JSON document in VS Code's native text editor. Edit the objective and save the document to create the session.

Expand a session and select **Agent**, **Relevant files**, **Decisions**, or **Runs**. ThreadPort opens the persistent session as a normal JSON document and moves the cursor to the selected section. Edit `objective` or `agent`, or fill an object under `add`, then save. CodeLens actions can activate the session, preview its context, or switch to an installed agent.

Project data stays locally in `.threadport/threadport.sqlite`. Context handoff files are temporary and removed after the agent terminal closes.

## Development

From the repository root:

```bash
npm install
npm run check:extension
npm run build:extension
```

Open `apps/vscode-extension` in VS Code and press `F5`, or use the root launch configuration. The Extension Development Host displays the ThreadPort icon in the Activity Bar.
