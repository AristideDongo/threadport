/** Collapses bursts of calls (SQLite WAL writes, saves) into one call after `delayMs` of quiet. */
export function debounce(work: () => void, delayMs: number): { (): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    clearTimeout(timer);
    timer = setTimeout(work, delayMs);
  };
  run.cancel = () => clearTimeout(timer);
  return run;
}
