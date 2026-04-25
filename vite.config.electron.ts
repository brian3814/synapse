import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { build as viteBuild } from 'vite';
import { access, readFile, writeFile, unlink, rmdir } from 'fs/promises';

let isDev = false;
const outDir = resolve(__dirname, 'dist-electron/renderer');

function layoutWorkerPlugin(): Plugin {
  return {
    name: 'layout-worker-build',
    apply: 'build',
    closeBundle: async () => {
      await viteBuild({
        configFile: false,
        mode: isDev ? 'development' : 'production',
        base: './',
        resolve: { alias: { '@': resolve(__dirname, 'src') } },
        build: {
          outDir,
          emptyOutDir: false,
          sourcemap: isDev,
          rollupOptions: {
            input: { 'layout-worker': resolve(__dirname, 'src/graph/layout/layout-worker.ts') },
            output: {
              entryFileNames: 'layout-worker.js',
              assetFileNames: '[name][extname]',
              chunkFileNames: 'assets/[name].js',
              manualChunks: undefined,
            },
          },
        },
      });
    },
  };
}

function dbWorkerPlugin(): Plugin {
  return {
    name: 'db-worker-build',
    apply: 'build',
    closeBundle: async () => {
      await viteBuild({
        configFile: false,
        mode: isDev ? 'development' : 'production',
        base: './',
        resolve: { alias: { '@': resolve(__dirname, 'src') } },
        build: {
          outDir,
          emptyOutDir: false,
          sourcemap: isDev,
          rollupOptions: {
            input: { 'db-worker': resolve(__dirname, 'src/db/worker/db-worker.ts') },
            output: {
              entryFileNames: 'db-worker.js',
              assetFileNames: '[name][extname]',
              chunkFileNames: 'assets/[name].js',
              manualChunks: undefined,
            },
          },
        },
      });
    },
  };
}

function dbSharedWorkerPlugin(): Plugin {
  return {
    name: 'db-shared-worker-build',
    apply: 'build',
    closeBundle: async () => {
      await viteBuild({
        configFile: false,
        mode: isDev ? 'development' : 'production',
        base: './',
        resolve: { alias: { '@': resolve(__dirname, 'src') } },
        build: {
          outDir,
          emptyOutDir: false,
          sourcemap: isDev,
          rollupOptions: {
            input: {
              'db-shared-worker': resolve(__dirname, 'src/db/worker/db-shared-worker.ts'),
            },
            output: {
              entryFileNames: 'db-shared-worker.js',
              assetFileNames: '[name][extname]',
              chunkFileNames: 'assets/[name].js',
              manualChunks: undefined,
            },
          },
        },
      });
    },
  };
}

function fixHtmlPlugin(): Plugin {
  return {
    name: 'fix-html',
    apply: 'build',
    closeBundle: async () => {
      const nested = resolve(outDir, 'src/ui/index.html');
      const target = resolve(outDir, 'index.html');
      try {
        await access(nested);
        let html = await readFile(nested, 'utf-8');
        html = html.replace(/(?:\.\.\/)+assets\//g, 'assets/');
        await writeFile(target, html, 'utf-8');
        await unlink(nested).catch(() => {});
        await rmdir(resolve(outDir, 'src/ui')).catch(() => {});
        await rmdir(resolve(outDir, 'src')).catch(() => {});
      } catch {
        // Already in the right place
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  isDev = mode === 'development';
  return {
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      fixHtmlPlugin(),
      dbWorkerPlugin(),
      dbSharedWorkerPlugin(),
      layoutWorkerPlugin(),
    ],
    resolve: {
      alias: { '@': resolve(__dirname, 'src') },
    },
    build: {
      outDir,
      emptyOutDir: true,
      sourcemap: true,
      minify: false,
      modulePreload: false,
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'src/ui/index.html'),
        },
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash].[ext]',
        },
      },
    },
  };
});
