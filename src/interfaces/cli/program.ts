import { Command } from 'commander';
import { packageVersion } from '../../infrastructure/package-info.js';
import { registerAgentCommands } from './commands/agents.js';
import { registerContinuityCommands } from './commands/continuity.js';
import { registerForkCommands } from './commands/forks.js';
import { registerRecordCommands } from './commands/records.js';
import { registerSessionCommands } from './commands/sessions.js';
import { registerSystemCommands } from './commands/system.js';

const cli = new Command();
cli
  .name('threadport')
  .description('Keep development sessions consistent across AI agents.')
  .version(packageVersion)
  .showHelpAfterError();
registerSessionCommands(cli);
registerRecordCommands(cli);
registerContinuityCommands(cli);
registerForkCommands(cli);
registerAgentCommands(cli);
registerSystemCommands(cli);

cli.parseAsync(process.argv).catch((error: unknown) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
