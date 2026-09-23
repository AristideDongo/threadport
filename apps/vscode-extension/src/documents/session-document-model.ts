export interface SessionDocumentEdit {
  readonly objective: string;
  readonly agent: string | null;
  readonly nextInstruction: string;
  readonly add: {
    readonly relevantFile: { readonly path: string; readonly reason: string };
    readonly decision: { readonly title: string; readonly rationale: string };
  };
}

const editableHeadings = ['Objective', 'Agent', 'Next instruction', 'Add relevant file', 'Record decision'] as const;
type EditableHeading = typeof editableHeadings[number];

function section(content: string, heading: EditableHeading): string {
  const marker = `## ${heading}`;
  const start = content.indexOf(marker);
  if (start < 0) throw new Error(`Missing "${marker}" section.`);
  const bodyStart = start + marker.length;
  const next = content.indexOf('\n## ', bodyStart);
  const generated = content.indexOf('\n<!-- threadport:generated -->', bodyStart);
  const candidates = [next, generated].filter((value) => value >= 0);
  const end = candidates.length ? Math.min(...candidates) : content.length;
  return content.slice(bodyStart, end).trim();
}

function bounded(value: string, label: string, maximum: number): string {
  const normalized = value.trim();
  if (normalized.length > maximum) throw new Error(`${label} must contain at most ${maximum} characters.`);
  return normalized;
}

function singleLine(value: string, label: string, maximum: number): string {
  const normalized = bounded(value, label, maximum);
  if (/\r|\n/.test(normalized)) throw new Error(`${label} must stay on one line.`);
  return normalized;
}

function fields(value: string): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  let current: string | null = null;
  for (const line of value.split(/\r?\n/)) {
    const match = /^([A-Za-z ]+):\s*(.*)$/.exec(line);
    if (match?.[1]) {
      current = match[1].trim().toLowerCase();
      result.set(current, match[2] ?? '');
    } else if (current) {
      result.set(current, `${result.get(current) ?? ''}\n${line}`.trim());
    }
  }
  return result;
}

export function parseSessionDocument(content: string): SessionDocumentEdit {
  const objective = singleLine(section(content, 'Objective'), 'Objective', 200);
  if (!objective) throw new Error('Objective cannot be empty.');
  const agentValue = singleLine(section(content, 'Agent'), 'Agent', 40);
  const relevantFile = fields(section(content, 'Add relevant file'));
  const decision = fields(section(content, 'Record decision'));
  return {
    objective,
    agent: agentValue && agentValue.toLowerCase() !== 'none' ? agentValue.toLowerCase() : null,
    nextInstruction: bounded(section(content, 'Next instruction'), 'Next instruction', 20_000),
    add: {
      relevantFile: {
        path: singleLine(relevantFile.get('path') ?? '', 'Relevant file path', 500),
        reason: bounded(relevantFile.get('reason') ?? '', 'Relevant file reason', 20_000)
      },
      decision: {
        title: singleLine(decision.get('title') ?? '', 'Decision title', 200),
        rationale: bounded(decision.get('rationale') ?? '', 'Decision rationale', 20_000)
      }
    }
  };
}

export function headingOffset(content: string, heading: string): number {
  return Math.max(0, content.indexOf(`## ${heading}`));
}
