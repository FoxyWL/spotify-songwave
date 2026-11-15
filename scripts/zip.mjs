// Собирает songwave-extension.zip из dist/ — готовый к «Загрузить распакованное расширение».
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(resolve(root, 'dist/manifest.json'))) throw new Error('Сначала npm run build');
const out = resolve(root, 'songwave-extension.zip');
rmSync(out, { force: true });
execFileSync('zip', ['-qr', out, '.'], { cwd: resolve(root, 'dist') });
console.log(`→ ${out}`);
