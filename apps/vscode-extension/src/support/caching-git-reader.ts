import type { GitReader } from '../../../../src/application/ports.js';
import type { GitState } from '../../../../src/domain/model.js';

/**
 * Session documents, CodeLens and the tree read Git state in bursts. Reading `git status` and the full
 * diff synchronously each time froze the extension host, so results are reused for a short time and
 * dropped whenever a file is saved or ThreadPort data changes.
 */
export class CachingGitReader implements GitReader {
  readonly #cache = new Map<string, { readonly at: number; readonly state: GitState | null }>();

  constructor(
    private readonly inner: GitReader,
    private readonly ttlMs = 3_000,
    private readonly now: () => number = Date.now,
  ) {}

  read(cwd: string): GitState | null {
    const cached = this.#cache.get(cwd);
    if (cached && this.now() - cached.at < this.ttlMs) return cached.state;
    const state = this.inner.read(cwd);
    this.#cache.set(cwd, { at: this.now(), state });
    return state;
  }

  invalidate(): void {
    this.#cache.clear();
  }
}
