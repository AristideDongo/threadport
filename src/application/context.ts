import type { ContextMode, GitState, Session } from '../domain/model.js';
import type { SessionStore } from './ports.js';

const budgets: Record<ContextMode, number> = { minimal: 2000, standard: 6000, deep: 16000, full: 40000 };

function globRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*').replace(/\?/g, '.');
  return new RegExp(`(^|/)${escaped}$`);
}

export function excluded(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => globRegex(pattern).test(path));
}

export function safeDiff(diff: string, patterns: readonly string[]): string {
  return diff.split(/(?=^diff --git )/m).filter((block) => {
    const header = block.split('\n', 1)[0] ?? '';
    const match = /^diff --git a\/(.*?) b\/(.*)$/.exec(header);
    return match ? !excluded(match[2] ?? '', patterns) : !block.trim();
  }).join('').slice(0, 512_000);
}

export function redact(text: string): string {
  return text
    .replace(/(sk-[A-Za-z0-9_-]{12,})/g, '[REDACTED]')
    .replace(/(gh[pousr]_[A-Za-z0-9_]{12,})/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|secret|password|token)\s*[:=]\s*)["'][^"'\n]*["']/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|secret|password|token)\s*[:=]\s*)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]');
}

export function buildContext(store: SessionStore, session: Session, git: GitState | null, mode: ContextMode, patterns: readonly string[]): string {
  const sections = [`# ThreadPort handoff`, `Session: ${session.id}`, `Objective: ${redact(session.title)}`, `Status: ${session.status}`];
  const decisions = store.listDecisions(session.id);
  if (decisions.length) sections.push('\n## Decisions', ...decisions.map((item) => `- ${redact(item.title)}${item.rationale ? ` — ${redact(item.rationale)}` : ''}`));
  const events = store.listEvents(session.id).slice(mode === 'minimal' ? -3 : mode === 'standard' ? -10 : -30);
  if (events.length) sections.push('\n## Recent timeline', ...events.map((item) => `- ${item.createdAt} ${item.type}: ${redact(item.message)}`));
  if (git) {
    sections.push('\n## Git', `Branch: ${git.branch ?? 'unknown'}`, `HEAD: ${git.head ?? 'unknown'}`);
    const files = git.changedFiles.filter((file) => !excluded(file, patterns));
    if (files.length) sections.push('Changed files:', ...files.map((file) => `- ${file}`));
    if (mode === 'deep' || mode === 'full') {
      const visibleDiff = safeDiff(git.diff, patterns);
      if (visibleDiff) sections.push('\n## Git diff (redacted)', redact(visibleDiff));
    }
  }
  sections.push('\nContinue from the current project state. Inspect files before changing them.');
  return sections.join('\n').slice(0, budgets[mode]);
}
