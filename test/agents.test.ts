import { expect, it } from 'vitest';
import { adapterById } from '../src/infrastructure/agents.js';

it('passes a handoff path as a prompt to both agents', () => {
  for (const id of ['claude', 'codex']) {
    const args = adapterById(id).args('/tmp/threadport-handoff.md');
    expect(args).toHaveLength(1);
    expect(args[0]).toContain('/tmp/threadport-handoff.md');
    expect(adapterById(id).structuredArgs?.('/tmp/threadport-handoff.md').join(' ')).toContain(
      '/tmp/threadport-handoff.md',
    );
    expect(adapterById(id).resumeArgs?.('provider-session', '/tmp/threadport-handoff.md').join(' ')).toContain(
      'provider-session',
    );
  }
});
