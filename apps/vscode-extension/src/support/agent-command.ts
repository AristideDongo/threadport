export interface TerminalInvocation {
  readonly shellPath: string;
  readonly shellArgs: string[];
}

/**
 * Windows installs npm CLIs such as `claude` and `codex` as `.cmd` shims, which a terminal cannot start
 * directly as its shell, so those go through `cmd.exe`. Executables and other platforms start as-is.
 */
export function terminalInvocation(
  platform: NodeJS.Platform,
  command: string,
  resolvedPath: string | null,
  args: readonly string[],
  comSpec = 'cmd.exe',
): TerminalInvocation {
  if (platform !== 'win32') return { shellPath: command, shellArgs: [...args] };
  const target = resolvedPath ?? command;
  if (/\.exe$/i.test(target)) return { shellPath: target, shellArgs: [...args] };
  return { shellPath: comSpec, shellArgs: ['/d', '/c', target, ...args] };
}

/** First match printed by `where` (Windows) or `which`, or null when the command is missing. */
export function firstLocatedPath(output: string): string | null {
  return (
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? null
  );
}
