// Bundles the Electron main + preload (with the API server inlined) and copies the built web UI next to them.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDist = path.resolve(root, '../web/dist');
if (!existsSync(path.join(webDist, 'index.html'))) {
  console.error('Build the web app first: npm run build:web');
  process.exit(1);
}
rmSync(path.join(root, 'dist'), { recursive: true, force: true });
rmSync(path.join(root, 'web'), { recursive: true, force: true });

const common = {
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  bundle: true,
  sourcemap: false,
  minify: false,
  logLevel: 'info',
  legalComments: 'none',
};
await build({
  ...common,
  entryPoints: [path.join(root, 'src/main.ts')],
  outfile: path.join(root, 'dist/main.cjs'),
  external: ['electron'],
});
await build({
  ...common,
  entryPoints: [path.join(root, 'src/preload.ts')],
  outfile: path.join(root, 'dist/preload.cjs'),
  external: ['electron'],
});
mkdirSync(path.join(root, 'web'), { recursive: true });
cpSync(webDist, path.join(root, 'web'), { recursive: true });
console.log('desktop build ready');
