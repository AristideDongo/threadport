import { build } from 'esbuild';
import { readFileSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });

// `npm run build -- --dev` keeps a source map for the Extension Development Host; packaged builds stay small.
const dev = process.argv.includes('--dev');
const cliVersion = JSON.parse(readFileSync('../../package.json', 'utf8')).version;

/** package-info.ts reads package.json through import.meta.url, which a CommonJS bundle does not have. */
const inlinePackageVersion = {
  name: 'inline-package-version',
  setup(context) {
    context.onResolve({ filter: /infrastructure\/package-info\.js$/ }, () => ({
      path: 'package-info',
      namespace: 'threadport',
    }));
    context.onLoad({ filter: /.*/, namespace: 'threadport' }, () => ({
      contents: `export const packageVersion = ${JSON.stringify(cliVersion)};`,
      loader: 'js',
    }));
  },
};

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  minify: !dev,
  // Keeps function and class names readable in user stack traces even when minified.
  keepNames: true,
  sourcemap: dev ? 'linked' : false,
  logLevel: 'info',
  plugins: [inlinePackageVersion],
};

await build({ ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', external: ['vscode'] });
await build({
  ...common,
  entryPoints: ['src/mcp-server.ts'],
  outfile: 'dist/mcp-server.js',
  // Hide node:sqlite's ExperimentalWarning before any bundled module loads.
  banner: {
    js: "process.removeAllListeners('warning');process.on('warning',(w)=>{if(w.name==='ExperimentalWarning'&&w.message.includes('SQLite'))return;console.error(w.name+': '+w.message);});",
  },
});
