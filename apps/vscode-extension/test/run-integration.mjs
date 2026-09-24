// Launches a real VS Code (VSCODE_VERSION, default "stable") with the built extension and runs suite.cjs.
// CI also runs it against the minimum engine version to catch missing runtime APIs such as node:sqlite.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

const extensionDevelopmentPath = dirname(dirname(fileURLToPath(import.meta.url)));
const workspace = mkdtempSync(join(tmpdir(), 'threadport-vscode-it-'));
try {
  execFileSync('git', ['init', '-q'], { cwd: workspace });
  await runTests({
    version: process.env.VSCODE_VERSION ?? 'stable',
    extensionDevelopmentPath,
    extensionTestsPath: join(extensionDevelopmentPath, 'test', 'integration', 'suite.cjs'),
    launchArgs: [
      workspace,
      '--disable-extensions',
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
    ],
  });
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
