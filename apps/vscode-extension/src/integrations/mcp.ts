import { EventEmitter, McpStdioServerDefinition, lm, type Disposable, type ExtensionContext } from 'vscode';
import type { ProjectRuntimes } from '../bootstrap/project-runtimes.js';
import { workspaceFolders } from '../vscode-adapters/workspace-projects.js';

/**
 * Offers one ThreadPort MCP server per initialized workspace folder to VS Code's chat agents, so they can
 * read the session context and record notes, tasks and decisions. VS Code asks the user before starting it.
 */
export function registerMcpServers(
  context: ExtensionContext,
  projects: ProjectRuntimes,
): { readonly disposable: Disposable; refresh(): void } {
  const changes = new EventEmitter<void>();
  const script = context.asAbsolutePath('dist/mcp-server.js');
  const version = String((context.extension.packageJSON as { version?: unknown }).version ?? '0.0.0');
  const registration = lm.registerMcpServerDefinitionProvider('threadport.mcp', {
    onDidChangeMcpServerDefinitions: changes.event,
    provideMcpServerDefinitions: () =>
      workspaceFolders()
        .filter((folder) => projects.isInitialized(folder))
        .map((folder) => {
          const label = workspaceFolders().length > 1 ? `ThreadPort (${folder.name})` : 'ThreadPort';
          const server = new McpStdioServerDefinition(
            label,
            process.execPath,
            [script],
            { ELECTRON_RUN_AS_NODE: 1 },
            version,
          );
          server.cwd = folder.uri;
          return server;
        }),
  });
  return {
    disposable: {
      dispose: () => {
        registration.dispose();
        changes.dispose();
      },
    },
    refresh: () => changes.fire(),
  };
}
