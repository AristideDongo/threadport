export interface SessionDocumentEdit {
  readonly objective: string;
  readonly agent: string | null;
  readonly add: {
    readonly relevantFile: { readonly path: string; readonly reason: string };
    readonly decision: { readonly title: string; readonly rationale: string };
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const normalized = value.trim();
  if (normalized.length > maximum) throw new Error(`${label} must contain at most ${maximum} characters.`);
  return normalized;
}

export function parseSessionDocument(content: string): SessionDocumentEdit {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error('The ThreadPort document must contain valid JSON.');
  }
  const root = record(raw, 'Document');
  const objective = text(root.objective, 'Objective', 200);
  if (!objective) throw new Error('Objective cannot be empty.');
  const agent = root.agent === null ? null : text(root.agent, 'Agent', 40);
  const additions = record(root.add, 'add');
  const file = record(additions.relevantFile, 'add.relevantFile');
  const decision = record(additions.decision, 'add.decision');
  return {
    objective,
    agent: agent || null,
    add: {
      relevantFile: {
        path: text(file.path, 'Relevant file path', 200),
        reason: text(file.reason, 'Relevant file reason', 20_000)
      },
      decision: {
        title: text(decision.title, 'Decision title', 200),
        rationale: text(decision.rationale, 'Decision rationale', 20_000)
      }
    }
  };
}
