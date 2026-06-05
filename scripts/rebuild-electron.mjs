import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const electronPkg = JSON.parse(readFileSync(resolve(root, 'node_modules/electron/package.json'), 'utf-8'));
const electronVersion = electronPkg.version;

const modulePath = resolve(root, 'node_modules/better-sqlite3');

console.log(`Rebuilding better-sqlite3 for Electron ${electronVersion}...`);
execSync(
  `npx node-gyp rebuild --runtime=electron --target=${electronVersion} --dist-url=https://electronjs.org/headers`,
  { cwd: modulePath, stdio: 'inherit' },
);
console.log('Rebuild complete');
