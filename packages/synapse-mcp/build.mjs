import * as esbuild from 'esbuild';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(__dirname, '../../src');

/** Resolve @/ prefix to ../../src/ (project root src/) */
const aliasPlugin = {
  name: 'resolve-at-alias',
  setup(build) {
    build.onResolve({ filter: /^@\// }, (args) => {
      const stripped = args.path.slice(2); // remove '@/'
      const base = path.resolve(srcRoot, stripped);
      // Try with TypeScript extensions
      for (const ext of ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js']) {
        const candidate = base + ext;
        if (fs.existsSync(candidate)) {
          return { path: candidate };
        }
      }
      // Fallback: return as-is and let esbuild report the error
      return { path: base };
    });
  },
};

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  outdir: 'dist',
  format: 'esm',
  banner: { js: '#!/usr/bin/env node' },
  packages: 'external',
  plugins: [aliasPlugin],
});
