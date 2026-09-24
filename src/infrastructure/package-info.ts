import { readFileSync } from 'node:fs';

const metadata: unknown = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
if (
  typeof metadata !== 'object' ||
  metadata === null ||
  !('version' in metadata) ||
  typeof metadata.version !== 'string'
) {
  throw new Error('ThreadPort package version was not found.');
}
export const packageVersion: string = metadata.version;
