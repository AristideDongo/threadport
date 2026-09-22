export type SessionSection = 'overview' | 'agent' | 'files' | 'decisions' | 'runs';

export type SessionPageMessage =
  | { readonly type: 'navigate'; readonly section: SessionSection }
  | { readonly type: 'createSession'; readonly projectUri: string; readonly objective: string; readonly agentId: string | null }
  | { readonly type: 'activateSession' }
  | { readonly type: 'addFile'; readonly path: string; readonly reason: string }
  | { readonly type: 'addDecision'; readonly title: string; readonly rationale: string }
  | { readonly type: 'switchAgent'; readonly agentId: string }
  | { readonly type: 'refresh' };

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function section(value: unknown): SessionSection | null {
  return value === 'overview' || value === 'agent' || value === 'files' || value === 'decisions' || value === 'runs' ? value : null;
}

export function parseSessionPageMessage(value: unknown): SessionPageMessage | null {
  const message = object(value);
  if (!message || typeof message.type !== 'string') return null;
  if (message.type === 'navigate') {
    const valueSection = section(message.section);
    return valueSection ? { type: 'navigate', section: valueSection } : null;
  }
  if (message.type === 'createSession') {
    if (typeof message.projectUri !== 'string' || typeof message.objective !== 'string') return null;
    if (message.agentId !== null && typeof message.agentId !== 'string') return null;
    return { type: 'createSession', projectUri: message.projectUri, objective: message.objective, agentId: message.agentId };
  }
  if (message.type === 'addFile' && typeof message.path === 'string' && typeof message.reason === 'string') {
    return { type: 'addFile', path: message.path, reason: message.reason };
  }
  if (message.type === 'addDecision' && typeof message.title === 'string' && typeof message.rationale === 'string') {
    return { type: 'addDecision', title: message.title, rationale: message.rationale };
  }
  if (message.type === 'switchAgent' && typeof message.agentId === 'string') return { type: 'switchAgent', agentId: message.agentId };
  if (message.type === 'activateSession' || message.type === 'refresh') return { type: message.type };
  return null;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

