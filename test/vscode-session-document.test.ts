import { describe, expect, it } from 'vitest';
import { parseSessionDocument } from '../apps/vscode-extension/src/documents/session-document-model.js';

describe('VS Code native session documents', () => {
  it('parses editable session fields and additions', () => {
    expect(parseSessionDocument(JSON.stringify({
      objective: 'Implement authentication',
      agent: 'codex',
      add: {
        relevantFile: { path: 'src/auth.ts', reason: 'Main service' },
        decision: { title: 'Use Redis', rationale: 'Supports expiry' }
      }
    }))).toEqual({
      objective: 'Implement authentication',
      agent: 'codex',
      add: {
        relevantFile: { path: 'src/auth.ts', reason: 'Main service' },
        decision: { title: 'Use Redis', rationale: 'Supports expiry' }
      }
    });
  });

  it('rejects malformed or empty documents', () => {
    expect(() => parseSessionDocument('{')).toThrow('valid JSON');
    expect(() => parseSessionDocument(JSON.stringify({ objective: '', agent: null, add: { relevantFile: {}, decision: {} } }))).toThrow('Objective cannot be empty');
  });
});
