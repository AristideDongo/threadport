// Stand-alone MCP server bundled with the extension (dist/mcp-server.js). VS Code starts it with its own
// runtime (ELECTRON_RUN_AS_NODE) in a workspace folder, so users do not need a global `threadport` install.
// esbuild.mjs prepends a filter for the node:sqlite ExperimentalWarning: imports would run before code here.

import { ThreadPort } from '../../../src/application/threadport.js';
import { GitCliReader } from '../../../src/infrastructure/git.js';
import { loadExcludes } from '../../../src/infrastructure/privacy.js';
import { findProjectRoot } from '../../../src/infrastructure/project.js';
import { SqliteStore } from '../../../src/infrastructure/sqlite-store.js';
import { join } from 'node:path';
import { serveMcp } from '../../../src/interfaces/mcp/server.js';

async function main(): Promise<void> {
  const root = findProjectRoot(process.cwd());
  if (!root) throw new Error('ThreadPort is not initialized in this folder.');
  const store = new SqliteStore(join(root, '.threadport', 'threadport.sqlite'));
  try {
    await serveMcp(new ThreadPort(store, new GitCliReader(), root, loadExcludes(root)), root);
  } finally {
    store.close();
  }
}

main().catch((error: unknown) => {
  console.error(`ThreadPort MCP: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
