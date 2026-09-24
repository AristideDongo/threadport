import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const projectDirName = '.threadport';
export const databaseFileName = 'threadport.sqlite';
const gitignore = '# Local ThreadPort data (sessions, notes, diffs). Never commit it.\n*\n';

/** Returns the closest directory at or above `start` that contains a ThreadPort database. */
export function findProjectRoot(start: string): string | null {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, projectDirName, databaseFileName))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Creates the private project directory and keeps its data out of Git. */
export function ensureProjectDir(root: string): string {
  const directory = join(root, projectDirName);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const ignore = join(directory, '.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, gitignore, { mode: 0o600 });
  return directory;
}
