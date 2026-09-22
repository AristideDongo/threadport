import { window, workspace, type QuickPickItem, type WorkspaceFolder } from 'vscode';

interface FolderPick extends QuickPickItem {
  readonly folder: WorkspaceFolder;
}

export function workspaceFolders(): readonly WorkspaceFolder[] {
  return workspace.workspaceFolders ?? [];
}

export async function selectWorkspaceFolder(placeHolder: string): Promise<WorkspaceFolder | undefined> {
  const folders = workspaceFolders();
  if (folders.length === 0) {
    await window.showErrorMessage('Open a project folder before using ThreadPort.');
    return undefined;
  }
  if (folders.length === 1) return folders[0];
  const picks: FolderPick[] = folders.map((folder) => ({
    label: folder.name,
    description: folder.uri.fsPath,
    folder
  }));
  return (await window.showQuickPick(picks, { placeHolder }))?.folder;
}

