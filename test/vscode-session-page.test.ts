import { describe, expect, it } from 'vitest';
import { escapeHtml, parseSessionPageMessage } from '../apps/vscode-extension/src/webviews/session-page-model.js';

describe('VS Code session page messages', () => {
  it('accepts typed additions and rejects incomplete messages', () => {
    expect(parseSessionPageMessage({ type: 'addFile', path: 'src/app.ts', reason: 'Entry point' })).toEqual({
      type: 'addFile',
      path: 'src/app.ts',
      reason: 'Entry point'
    });
    expect(parseSessionPageMessage({ type: 'addDecision', title: 'Use SQLite' })).toBeNull();
    expect(parseSessionPageMessage({ type: 'navigate', section: 'secrets' })).toBeNull();
  });

  it('keeps create-session messages explicit', () => {
    expect(parseSessionPageMessage({
      type: 'createSession',
      projectUri: 'file:///project',
      objective: 'Implement authentication',
      agentId: 'claude'
    })).toEqual({
      type: 'createSession',
      projectUri: 'file:///project',
      objective: 'Implement authentication',
      agentId: 'claude'
    });
    expect(parseSessionPageMessage({ type: 'createSession', projectUri: 'file:///project', objective: 42, agentId: null })).toBeNull();
  });

  it('escapes recorded content before rendering HTML', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });
});
