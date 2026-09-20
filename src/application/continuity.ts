import type { AgentRun, Decision, GitState, Session, WorkRecord } from '../domain/model.js';

export interface VerificationCommand { command: string; args: string[]; }
export interface VerificationResult { command: string; args: string[]; exitCode: number; durationMs: number; recordId: string; }
export interface VerificationReport {
  version: 1;
  startedAt: string;
  endedAt: string;
  fingerprint: string | null;
  head: string | null;
  unchanged: boolean;
  passed: boolean;
  results: VerificationResult[];
}
export interface SavedHandoff { version: 1; fingerprint: string | null; content: string; }
export interface PrivacyAudit { redactedFields: number; excludedReferences: number; contextTokens: number; warnings: string[]; }

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function parseVerification(body: string): VerificationReport | null {
  try {
    const value = object(JSON.parse(body) as unknown);
    if (value?.version !== 1 || typeof value.startedAt !== 'string' || typeof value.endedAt !== 'string' ||
      !(value.fingerprint === null || typeof value.fingerprint === 'string') ||
      !(value.head === null || typeof value.head === 'string') ||
      typeof value.unchanged !== 'boolean' || typeof value.passed !== 'boolean' || !Array.isArray(value.results)) return null;
    if (!value.results.every((item: unknown) => {
      const result = object(item);
      return result && typeof result.command === 'string' && Array.isArray(result.args) && result.args.every((arg: unknown) => typeof arg === 'string') &&
        typeof result.exitCode === 'number' && typeof result.durationMs === 'number' && typeof result.recordId === 'string';
    })) return null;
    return value as unknown as VerificationReport;
  } catch { return null; }
}
export function parseHandoff(body: string): SavedHandoff | null {
  try {
    const value = object(JSON.parse(body) as unknown);
    if (value?.version !== 1 || !(value.fingerprint === null || typeof value.fingerprint === 'string') || typeof value.content !== 'string') return null;
    return value as unknown as SavedHandoff;
  } catch { return null; }
}
export function githubWorkLink(kind: 'issue' | 'pr', raw: string): { title: string; url: string } {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Provide a GitHub issue or pull request URL.'); }
  const match = /^\/([^/]+)\/([^/]+)\/(issues|pull)\/([1-9]\d*)\/?$/.exec(url.pathname);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash || !match || match[3] !== (kind === 'issue' ? 'issues' : 'pull')) {
    throw new Error(`Provide a canonical GitHub ${kind === 'issue' ? 'issue' : 'pull request'} URL.`);
  }
  return { title: `${kind === 'issue' ? 'Issue' : 'PR'} #${match[4]}`, url: `https://github.com/${match[1]}/${match[2]}/${match[3]}/${match[4]}` };
}

export function renderHandoff(input: {
  session: Session;
  git: GitState | null;
  fingerprint: string | null;
  records: WorkRecord[];
  decisions: Decision[];
  runs: AgentRun[];
  verification: VerificationReport | null;
}): string {
  const { session, git, fingerprint, records, decisions, runs, verification } = input;
  const tasks = records.filter((item) => item.kind === 'task');
  const errors = records.filter((item) => item.kind === 'error' && item.status !== 'done');
  const links = records.filter((item) => item.kind === 'link');
  const notes = records.filter((item) => item.kind === 'note').slice(-5);
  const valid = verification?.passed === true && verification.unchanged && verification.fingerprint !== null && verification.fingerprint === fingerprint;
  const lines = [
    `# Handoff: ${session.title}`,
    '',
    `Session: ${session.id}`,
    `Git: ${git?.branch ?? 'unavailable'} @ ${git?.head ?? 'unavailable'}`,
    `Git fingerprint: ${fingerprint ?? 'unavailable'}`,
    '',
    '## Linked work',
    ...(links.length ? links.map((item) => `- ${item.title}: ${item.body} (record:${item.id})`) : ['- None recorded.']),
    '',
    '## Completed',
    ...(tasks.filter((item) => item.status === 'done').length ? tasks.filter((item) => item.status === 'done').map((item) => `- ${item.title} (record:${item.id})`) : ['- None recorded.']),
    '',
    '## Next steps',
    ...(tasks.filter((item) => item.status === 'open').length ? tasks.filter((item) => item.status === 'open').map((item) => `- ${item.title} (record:${item.id})`) : ['- None recorded.']),
    '',
    '## Changes and decisions',
    ...(git?.changedFiles.length ? git.changedFiles.map((path) => `- Changed: ${path}`) : ['- No uncommitted file changes.']),
    ...decisions.slice(-5).map((item) => `- Decision: ${item.title}${item.rationale ? ` — ${item.rationale}` : ''} (decision:${item.id})`),
    ...notes.map((item) => `- Note: ${item.title}${item.body ? ` — ${item.body}` : ''} (record:${item.id})`),
    '',
    '## Blockers',
    ...(errors.length ? errors.map((item) => `- ${item.title} (record:${item.id})`) : ['- None recorded.']),
    '',
    '## Verification',
    valid ? '- Passed on the current Git state.' : '- Unverified or stale for the current Git state.',
    ...(verification?.results.map((result) => `- ${[result.command, ...result.args].join(' ')}: exit ${result.exitCode} (record:${result.recordId})`) ?? []),
    '',
    `Last agent: ${runs.at(-1)?.agentId ?? 'none'} (${runs.at(-1)?.status ?? 'no run'})`,
    'Capture limit: private interactive conversation and reasoning are not available to ThreadPort.',
  ];
  return lines.join('\n');
}
