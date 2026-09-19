import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const defaultExcludes = ['.env', '.env.*', '*.pem', '*.key', 'credentials.json', 'secrets/**', '.threadport/**'];


export function loadExcludes(cwd: string): string[] {
  let custom: string[] = [];
  try {
    custom = readFileSync(join(cwd, '.threadportignore'), 'utf8').split(/\r?\n/).map((line) => line.trim()).filter((line) => Boolean(line) && !line.startsWith('#'));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return [...defaultExcludes, ...custom];
}

