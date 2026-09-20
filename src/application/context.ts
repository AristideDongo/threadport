import { getEncoding } from 'js-tiktoken';
import { createHash } from 'node:crypto';
import type { ContextMode, GitState, Session, WorkRecord } from '../domain/model.js';
import type { SessionStore } from './ports.js';
import { parseHandoff, parseVerification } from './continuity.js';

const encoding = getEncoding('cl100k_base');
const budgets: Record<ContextMode, number> = { minimal: 500, standard: 1500, deep: 4000, full: 10000 };
export interface ContextSection { label: string; source: string; tokens: number; }
export interface ContextPack { text: string; tokens: number; budget: number; included: ContextSection[]; omitted: string[]; excludedPaths: string[]; }

function globRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*').replace(/\?/g, '.');
  return new RegExp(`(^|/)${escaped}$`);
}
export function excluded(path: string, patterns: readonly string[]): boolean { return patterns.some((pattern) => globRegex(pattern).test(path)); }
export function safeDiff(diff: string, patterns: readonly string[]): string {
  return diff.split(/(?=^diff --git )/m).filter((block) => {
    const header = block.split('\n', 1)[0] ?? '';
    const match = /^diff --git a\/(.*?) b\/(.*)$/.exec(header);
    return match ? !excluded(match[1] ?? '', patterns) && !excluded(match[2] ?? '', patterns) : !block.trim();
  }).join('').slice(0, 512_000);
}
export function redact(value: string): string {
  return value
    .replace(/(sk-[A-Za-z0-9_-]{12,})/g, '[REDACTED]')
    .replace(/(gh[pousr]_[A-Za-z0-9_]{12,})/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|secret|password|token)\s*[:=]\s*)["'][^"'\n]*["']/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|secret|password|token)\s*[:=]\s*)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]');
}
function count(value: string): number { return encoding.encode(value).length; }
function renderRecords(records: WorkRecord[]): string { return records.map((item) => `- [${item.status}] ${item.title}${item.body ? `: ${item.body}` : ''} (record:${item.id})`).join('\n'); }
export function gitFingerprint(git: GitState | null, patterns: readonly string[] = []): string | null {
  return git ? createHash('sha256').update(JSON.stringify([git.branch, git.head, git.changedFiles.filter((path) => !excluded(path, patterns)), safeDiff(git.diff, patterns)])).digest('hex').slice(0, 16) : null;
}

export function buildContextPack(store: SessionStore, session: Session, git: GitState | null, mode: ContextMode, patterns: readonly string[], forkId: string | null = null): ContextPack {
  const budget = budgets[mode];
  const included: ContextSection[] = [];
  const omitted: string[] = [];
  const excludedPaths = git?.changedFiles.filter((file) => excluded(file, patterns)) ?? [];
  const parts: string[] = [];
  let used = 0;
  const fit = (value: string, allowance: number): string => {
    if (count(value) <= allowance) return value;
    let low = 0;
    let high = value.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (count(value.slice(0, middle) + '…') <= allowance) low = middle;
      else high = middle - 1;
    }
    return low ? value.slice(0, low) + '…' : '';
  };
  const add = (label: string, source: string, raw: string): void => {
    const content = redact(raw).trim();
    if (!content) return;
    const prefix = `${parts.length ? '\n\n' : ''}## ${label} [${source}]\n`;
    const fitted = fit(content, budget - used - count(prefix));
    if (!fitted) { omitted.push(label); return; }
    const chunk = prefix + fitted;
    const tokens = count(chunk);
    if (fitted !== content) omitted.push(`${label} (truncated)`);
    parts.push(chunk); used += tokens; included.push({ label, source, tokens });
  };
  const addItems = (label: string, source: string, items: string[]): void => {
    if (!items.length) return;
    const prefix = `${parts.length ? '\n\n' : ''}## ${label} [${source}]\n`;
    if (used + count(prefix) >= budget) { omitted.push(label); return; }
    let content = '';
    let skipped = 0;
    for (const item of items) {
      const line = `${content ? '\n' : ''}${redact(item)}`;
      const fitted = fit(line, budget - used - count(prefix + content));
      if (!fitted) { skipped++; continue; }
      content += fitted;
      if (fitted !== line) skipped++;
    }
    if (!content) { omitted.push(label); return; }
    const chunk = prefix + content;
    const tokens = count(chunk);
    parts.push(chunk); used += tokens; included.push({ label, source, tokens });
    if (skipped) omitted.push(`${label} (${skipped} item(s) truncated or omitted)`);
  };
  add('Session', `session:${session.id}`, `Objective: ${session.title}\nStatus: ${session.status}`);
  const records = store.listRecords(session.id).filter((item) => (item.forkId ?? null) === forkId);
  const summaries = records.filter((item) => item.kind === 'summary').slice(-1);
  const memory = store.listProjectMemory().slice(-5);
  const openTasks = records.filter((item) => item.kind === 'task' && item.status === 'open');
  const constraints = records.filter((item) => item.kind === 'constraint');
  const relevantFiles = records.filter((item) => item.kind === 'file' && !excluded(item.title, patterns));
  const artifacts = records.filter((item) => item.kind === 'artifact' && !excluded(item.title, patterns)).slice(-5);
  const errors = records.filter((item) => item.kind === 'error' && item.status !== 'done').slice(-5);
  const tests = records.filter((item) => item.kind === 'test').slice(-5);
  const notes = records.filter((item) => item.kind === 'note').slice(-5);
  addItems('Open tasks', 'work-records', openTasks.map((item) => renderRecords([item])));
  addItems('Current errors', 'work-records', errors.map((item) => renderRecords([item])));
  if (git) {
    const files = git.changedFiles.filter((file) => !excluded(file, patterns));
    add('Git state', 'git:live', `Branch: ${git.branch ?? 'unknown'}\nHEAD: ${git.head ?? 'unknown'}\nChanged files:\n${files.map((file) => `- ${file}`).join('\n')}`);
  }
  const handoffIndex = records.findLastIndex((item) => item.kind === 'handoff');
  if (handoffIndex >= 0) {
    const handoff = parseHandoff(records[handoffIndex]?.body ?? '');
    if (handoff) {
      const stale = handoff.fingerprint !== gitFingerprint(git, patterns) || records.slice(handoffIndex + 1).some((item) => item.kind !== 'summary');
      add('Saved handoff', 'work-records', `${stale ? '⚠ Handoff may be stale; review current files.\n' : ''}${handoff.content}`);
    }
  }
  const verification = records.filter((item) => item.kind === 'verification').at(-1);
  if (verification) {
    const report = parseVerification(verification.body);
    if (report) add('Verification', 'work-records', report.passed && report.fingerprint !== null && report.fingerprint === gitFingerprint(git, patterns)
      ? `Passed on current Git state: ${report.results.map((item) => `${item.command} ${item.args.join(' ')}`).join('; ')}`
      : 'Unverified or stale for the current Git state.');
  }
  addItems('Linked work', 'work-records', records.filter((item) => item.kind === 'link').map((item) => `- ${item.title}: ${item.body}`));
  const latestSummary = summaries[0];
  if (latestSummary) {
    const match = /\nGit fingerprint: ([a-f0-9]{16}|unavailable)$/.exec(latestSummary.body);
    const current = gitFingerprint(git, patterns);
    const summaryIndex = records.findIndex((item) => item.id === latestSummary.id);
    const newerWork = records.slice(summaryIndex + 1).some((item) => item.kind !== 'summary') || decisionsAfterSummary(store, session.id, latestSummary.createdAt);
    const state = match?.[1] && match[1] === (current ?? 'unavailable') && !newerWork ? '' : '⚠ Summary may be stale: Git state or recorded work changed.\n';
    add('Latest summary', 'work-records', `${state}${renderRecords([{ ...latestSummary, body: latestSummary.body.replace(/\nGit fingerprint: (?:[a-f0-9]{16}|unavailable)$/, '') }])}`);
  }
  addItems('Project memory', 'work-records', memory.map((item) => renderRecords([item])));
  addItems('Constraints', 'work-records', constraints.map((item) => renderRecords([item])));
  const decisions = store.listDecisions(session.id);
  addItems('Decisions', 'decisions', decisions.map((item) => `- ${item.title}${item.rationale ? `: ${item.rationale}` : ''} (decision:${item.id})`));
  addItems('Tests', 'work-records', tests.map((item) => renderRecords([item])));
  addItems('Recent notes', 'work-records', notes.map((item) => renderRecords([item])));
  addItems('Relevant files', 'work-records', relevantFiles.map((item) => renderRecords([item])));
  addItems('Artifacts', 'work-records', artifacts.map((item) => renderRecords([item])));
  add('Next step', 'threadport', 'Continue from the current project state. Inspect files before changing them.');
  const eventLimit = mode === 'minimal' ? 3 : mode === 'standard' ? 10 : 30;
  const events = forkId ? [] : store.listEvents(session.id).slice(-eventLimit);
  addItems('Recent timeline', 'events', events.map((item) => `- ${item.createdAt} ${item.type}: ${item.message}`));
  if (git && (mode === 'deep' || mode === 'full')) add('Git diff', 'git:live', safeDiff(git.diff, patterns));
  return { text: parts.join(''), tokens: used, budget, included, omitted, excludedPaths };
}
function decisionsAfterSummary(store: SessionStore, sessionId: string, createdAt: string): boolean {
  return store.listDecisions(sessionId).some((decision) => decision.createdAt > createdAt);
}
export function buildContext(store: SessionStore, session: Session, git: GitState | null, mode: ContextMode, patterns: readonly string[]): string {
  return buildContextPack(store, session, git, mode, patterns).text;
}
