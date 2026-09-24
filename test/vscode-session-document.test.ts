import { describe, expect, it } from 'vitest';
import { headingOffset, parseSessionDocument } from '../apps/vscode-extension/src/documents/session-document-model.js';

const document = `# ThreadPort session

## Objective
Implement authentication

## Agent
codex

## Next instruction
Fix the refresh-token race condition and run tests.

## Add relevant file
Path: src/auth.ts
Reason: Main service

## Record decision
Title: Use Redis
Rationale: Supports expiry

<!-- threadport:generated -->
## Runs
- codex · completed
`;

describe('VS Code native session documents', () => {
  it('parses editable Markdown fields without reading generated sections', () => {
    expect(parseSessionDocument(document)).toEqual({
      objective: 'Implement authentication',
      agent: 'codex',
      nextInstruction: 'Fix the refresh-token race condition and run tests.',
      add: {
        relevantFile: { path: 'src/auth.ts', reason: 'Main service' },
        decision: { title: 'Use Redis', rationale: 'Supports expiry' },
      },
    });
  });

  it('accepts none as an empty agent and locates native editor sections', () => {
    const value = document.replace('codex', 'none');
    expect(parseSessionDocument(value).agent).toBeNull();
    expect(headingOffset(value, 'Next instruction')).toBeGreaterThan(0);
  });

  it('rejects missing sections and an empty objective', () => {
    expect(() => parseSessionDocument('# Incomplete')).toThrow('Missing "## Objective"');
    expect(() => parseSessionDocument(document.replace('Implement authentication', ''))).toThrow(
      'Objective cannot be empty',
    );
  });
});
