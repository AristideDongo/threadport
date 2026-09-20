import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { interpretAgentEvents } from '../src/infrastructure/structured-agent.js';

const requested = process.argv.slice(2);
const agents = requested.length ? requested : ['claude', 'codex'];
const temp = mkdtempSync(join(tmpdir(), 'threadport-agent-smoke-'));
try {
  for (const agent of agents) {
    if (agent !== 'claude' && agent !== 'codex') throw new Error(`Unknown agent: ${agent}`);
    const args = agent === 'claude'
      ? ['-p', '--output-format', 'stream-json', '--verbose', 'Reply with exactly: THREADPORT_SMOKE_OK']
      : ['exec', '--json', '--skip-git-repo-check', 'Reply with exactly: THREADPORT_SMOKE_OK'];
    const result = spawnSync(agent, args, { cwd: temp, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${agent} exited with ${result.status}: ${result.stderr.slice(-1000)}`);
    const events = result.stdout.split(/\r?\n/).flatMap((line) => {
      try { return interpretAgentEvents(agent, JSON.parse(line) as unknown); } catch { return []; }
    });
    if (!events.some((event) => event.kind === 'session') || !events.some((event) => event.kind === 'message')) {
      throw new Error(`${agent} did not produce the session and message events ThreadPort expects.`);
    }
    console.log(`${agent}: structured events compatible`);
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
