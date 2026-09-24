// Runs inside the VS Code extension host (see run-integration.mjs).
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { join } = require('node:path');
const vscode = require('vscode');

async function eventually(check, message, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.fail(message);
}

exports.run = async () => {
  const extension = vscode.extensions.getExtension('aristideghost.threadport-vscode');
  assert.ok(extension, 'extension is installed');
  await extension.activate();

  const commands = await vscode.commands.getCommands(true);
  for (const id of [
    'threadport.newSession',
    'threadport.search',
    'threadport.showMenu',
    'threadport.draftHandoff',
    'threadport.showLogs',
  ])
    assert.ok(commands.includes(id), `${id} is registered`);

  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'a workspace folder is open');
  // Not awaited: the command ends by showing a notification that waits for the user.
  void vscode.commands.executeCommand('threadport.initializeProject', { kind: 'uninitialized', folder });
  const database = join(folder.uri.fsPath, '.threadport', 'threadport.sqlite');
  // Opening the database proves node:sqlite is available in this VS Code runtime.
  await eventually(() => existsSync(database), 'the project database is created');
  assert.ok(existsSync(join(folder.uri.fsPath, '.threadport', '.gitignore')), 'local data is ignored by Git');
};
