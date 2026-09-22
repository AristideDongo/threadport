import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const rules = [
  {
    directory: 'src/domain',
    forbidden: ['/application/', '/infrastructure/', '/interfaces/', 'vscode']
  },
  {
    directory: 'src/application',
    forbidden: ['/infrastructure/', '/interfaces/', 'vscode']
  }
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  }));
  return nested.flat().filter((path) => path.endsWith('.ts'));
}

const violations = [];
for (const rule of rules) {
  for (const file of await sourceFiles(rule.directory)) {
    const content = await readFile(file, 'utf8');
    for (const dependency of rule.forbidden) {
      if (content.includes(dependency)) violations.push(`${file} crosses the ${dependency} boundary`);
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log('Architecture boundaries are valid.');
