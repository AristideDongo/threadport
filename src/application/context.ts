import { getEncoding } from 'js-tiktoken';
import type { ContextMode, GitState, Session, WorkRecord } from '../domain/model.js';
import type { SessionStore } from './ports.js';

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

export function buildContextPack(store: SessionStore, session: Session, git: GitState | null, mode: ContextMode, patterns: readonly string[], forkId: string | null = null): ContextPack {
  const budget = budgets[mode];
  const included: ContextSection[] = [];
  const omitted: string[] = [];
  const excludedPaths = git?.changedFiles.filter((file) => excluded(file, patterns)) ?? [];
  const parts: string[] = [];
  let used = 0;
  const add = (label: string, source: string, raw: string): void => {
    const content = redact(raw).trim();
    if (!content) return;
    const chunk = `${parts.length ? '\n\n' : ''}## ${label} [${source}]\n${content}`;
    const tokens = count(chunk);
    if (used + tokens > budget) { omitted.push(label); return; }
    parts.push(chunk); used += tokens; included.push({ label, source, tokens });
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
  add('Latest summary', 'work-records', renderRecords(summaries));
  add('Project memory', 'work-records', renderRecords(memory));
  add('Constraints', 'work-records', renderRecords(constraints));
  add('Open tasks', 'work-records', renderRecords(openTasks));
  add('Current errors', 'work-records', renderRecords(errors));
  const decisions = store.listDecisions(session.id);
  add('Decisions', 'decisions', decisions.map((item) => `- ${item.title}${item.rationale ? `: ${item.rationale}` : ''} (decision:${item.id})`).join('\n'));
  add('Tests', 'work-records', renderRecords(tests));
  add('Recent notes', 'work-records', renderRecords(notes));
  add('Relevant files', 'work-records', renderRecords(relevantFiles));
  add('Artifacts', 'work-records', renderRecords(artifacts));
  add('Next step', 'threadport', 'Continue from the current project state. Inspect files before changing them.');
  if (git) {
    const files = git.changedFiles.filter((file) => !excluded(file, patterns));
    add('Git state', 'git:live', `Branch: ${git.branch ?? 'unknown'}\nHEAD: ${git.head ?? 'unknown'}\nChanged files:\n${files.map((file) => `- ${file}`).join('\n')}`);
  }
  const eventLimit = mode === 'minimal' ? 3 : mode === 'standard' ? 10 : 30;
  const events = forkId ? [] : store.listEvents(session.id).slice(-eventLimit);
  add('Recent timeline', 'events', events.map((item) => `- ${item.createdAt} ${item.type}: ${item.message}`).join('\n'));
  if (git && (mode === 'deep' || mode === 'full')) add('Git diff', 'git:live', safeDiff(git.diff, patterns));
  return { text: parts.join(''), tokens: used, budget, included, omitted, excludedPaths };
}
export function buildContext(store: SessionStore, session: Session, git: GitState | null, mode: ContextMode, patterns: readonly string[]): string {
  return buildContextPack(store, session, git, mode, patterns).text;
}
