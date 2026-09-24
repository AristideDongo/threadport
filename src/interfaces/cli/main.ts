#!/usr/bin/env node
// node:sqlite prints an ExperimentalWarning when it loads. It is noise for CLI users, so hide that
// one warning and keep every other warning. Static imports are evaluated first, so the program loads afterwards.
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'ExperimentalWarning' && warning.message.includes('SQLite')) return;
  console.error(`${warning.name}: ${warning.message}`);
});
await import('./program.js');
