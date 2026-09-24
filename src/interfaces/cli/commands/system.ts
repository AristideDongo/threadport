import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { assertMode } from '../../../domain/model.js';
import { loadExcludes } from '../../../infrastructure/privacy.js';
import { readConfig, setDefaultMode, verificationCommands } from '../../../infrastructure/config.js';
import { agentVersion } from '../../../infrastructure/agents.js';
import { openMenu } from '../../tui/menu.js';
import { serveApi } from '../../api/server.js';
import { serveMcp } from '../../mcp/server.js';
import { cwd, dbPath, git, knownAgents, runner, withProject, withProjectAsync } from '../runtime.js';

export function registerSystemCommands(cli: Command): void {
  const config = cli.command('config').description('View or change project configuration');
  config.command('show').description('Show effective configuration').action(() => console.log(JSON.stringify(readConfig(cwd), null, 2)));
  config.command('set-default-mode <mode>').description('Set the default context mode').action((value: string) => withProject(() => {
    const setting = setDefaultMode(cwd, assertMode(value));
    console.log(`✓ Default mode: ${setting.context.defaultMode}`);
  }));
  const privacy = cli.command('privacy').description('Manage stored private data');
  privacy.command('audit').description('Preview redaction and excluded references before sharing').option('--show-context', 'Print the redacted context pack').action((options: { showContext?: boolean }) => withProject((app) => {
    const mode = readConfig(cwd).context.defaultMode;
    const report = app.privacyAudit(mode);
    console.log(`Redaction candidates: ${report.redactedFields}\nExcluded references: ${report.excludedReferences}\nContext tokens: ${report.contextTokens}`);
    for (const warning of report.warnings) console.log(`⚠ ${warning}`);
    if (options.showContext) console.log(`\n${app.context(mode, loadExcludes(cwd))}`);
  }));
  privacy.command('scrub').description('Redact existing records and remove excluded file references').action(() => withProject((app) => {
    const result = app.scrub();
    console.log(`✓ Privacy scrub complete: ${result.updated} updated, ${result.removed} excluded records removed.`);
  }));
  cli.command('doctor').description('Check the local environment').action(() => {
    console.log(`Node     ${process.version}${Number(process.versions.node.split('.')[0]) >= 24 ? ' ✓' : ' (Node 24 required)'}`);
    console.log(`Project  ${existsSync(dbPath) ? 'initialized ✓' : 'not initialized'}`);
    console.log(`Git      ${git.read(cwd) ? 'repository found ✓' : 'no repository'}`);
    console.log(`Config   ${readConfig(cwd).context.defaultMode}`);
    for (const agent of knownAgents()) {
      const guide = agent.id === 'claude' ? ' · https://code.claude.com/docs/en/setup' : agent.id === 'codex' ? ' · https://developers.openai.com/codex/cli/' : '';
      // Never execute an untrusted project manifest command, even to read its version.
      if ('trusted' in agent && !agent.trusted) { console.log(`${agent.label.padEnd(11)} untrusted · threadport plugin trust ${agent.id}`); continue; }
      console.log(`${agent.label.padEnd(11)} ${runner.available(agent.command) ? `${agentVersion(agent.command) ?? 'available'} ✓` : `missing${guide}`}`);
    }
    console.log(`Checks   ${verificationCommands(cwd).length} configured or detected`);
    console.log(`Hooks    Claude ${existsSync(join(cwd, '.claude', 'settings.local.json')) ? 'configured' : 'optional'} · Codex ${existsSync(join(cwd, '.codex', 'hooks.json')) ? 'configured' : 'optional'}`);
    console.log('Structured capture should be checked after agent CLI upgrades.');
  });
  cli.command('tui').description('Open the interactive terminal menu').action(async () => withProjectAsync((app) => openMenu(app, cwd)));
  cli.command('serve').description('Start a local API with a temporary token').option('-p, --port <port>', 'TCP port', '0').action(async (options: { port: string }) => withProjectAsync((app) => {
    const port = Number(options.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port.');
    return serveApi(app, cwd, port);
  }));
  const mcp = cli.command('mcp').description('Start or configure the MCP server');
  mcp.action(async () => withProjectAsync((app) => serveMcp(app, cwd)));
  mcp.command('setup').description('Show commands to connect Claude Code or Codex to this project').action(() => {
    console.log('From this project directory, configure an MCP client with one of these commands:');
    console.log('  codex mcp add threadport -- threadport mcp');
    console.log('  claude mcp add --scope project threadport -- threadport mcp');
    console.log('The client must start ThreadPort with this project as its working directory.');
  });

}
