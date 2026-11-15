// Сборка расширения в dist/ (боевая) или test/e2e/out/ext (тестовая: адреса Spotify заменены на локальный мок).
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const test = args.includes('--test');
const port = (args.find((a) => a.startsWith('--port=')) || '--port=9911').split('=')[1];
const out = test ? resolve(root, 'test/e2e/out/ext') : resolve(root, 'dist');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const define = test ? { __API_BASE__: JSON.stringify(`http://127.0.0.1:${port}/v1`), __AUTH_BASE__: JSON.stringify(`http://127.0.0.1:${port}`) } : {};
const common = { bundle: true, format: 'iife', target: 'chrome116', legalComments: 'none', define, loader: { '.css': 'text' }, logLevel: 'warning', minify: !test, sourcemap: test ? 'inline' : false };

await build({ ...common, entryPoints: [resolve(root, 'src/extension/background.js')], outfile: resolve(out, 'background.js') });
await build({ ...common, entryPoints: [resolve(root, 'src/extension/content.js')], outfile: resolve(out, 'content.js') });

const manifest = JSON.parse(readFileSync(resolve(root, 'src/extension/manifest.json'), 'utf8'));
if (test) {
  // Тестовая сборка видит поддельную «open.spotify.com» на 127.0.0.1 и мок API.
  manifest.name += ' (test build)';
  manifest.host_permissions = [`http://127.0.0.1:${port}/*`];
  manifest.content_scripts[0].matches = ['http://127.0.0.1/*', `http://127.0.0.1:${port}/*`, `http://127.0.0.1:${Number(port) + 1}/*`];
  manifest.web_accessible_resources[0].matches = manifest.content_scripts[0].matches;
}
writeFileSync(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2));

cpSync(resolve(root, 'src/extension/icons'), resolve(out, 'icons'), { recursive: true, filter: (p) => !p.endsWith('.svg') || p.endsWith('mark.svg') });
mkdirSync(resolve(out, 'fonts'), { recursive: true });
const f = (pkg, name) => cpSync(resolve(root, `node_modules/@fontsource-variable/${pkg}/files/${name}`), resolve(out, 'fonts', name));
f('manrope', 'manrope-latin-wght-normal.woff2');
f('manrope', 'manrope-cyrillic-wght-normal.woff2');
f('dm-sans', 'dm-sans-latin-wght-normal.woff2');
console.log(`built ${test ? 'test' : 'production'} → ${out}`);
