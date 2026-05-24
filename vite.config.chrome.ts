import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { build as viteBuild } from 'vite';
import { access, readFile, writeFile, rmdir, unlink, copyFile } from 'fs/promises';

// Set by defineConfig's mode parameter; sub-build plugins read this
// to enable sourcemaps + skip minification in dev builds.
let isDev = false;

// Plugin to build the content script as IIFE after main build
function contentScriptPlugin(): Plugin {
  return {
    name: 'content-script-build',
    apply: 'build',
    closeBundle: async () => {
      await viteBuild({
        configFile: false,
        mode: isDev ? 'development' : 'production',
        resolve: {
          alias: {
            '@': resolve(__dirname, 'src'),
            '@platform': resolve(__dirname, 'src/platform/chrome'),
          },
        },
        build: {
          outDir: resolve(__dirname, 'dist'),
          emptyOutDir: false,
          lib: {
            entry: resolve(__dirname, 'src/content-script/index.ts'),
            name: 'contentScript',
            formats: ['iife'],
            fileName: () => 'content-script.js',
          },
          rollupOptions: {
            output: {
              extend: true,
            },
          },
        },
      });
    },
  };
}

// Plugin to build the layout worker as a separate ES module.
function layoutWorkerPlugin(): Plugin {
  return {
    name: 'layout-worker-build',
    apply: 'build',
    closeBundle: async () => {
      await viteBuild({
        configFile: false,
        mode: isDev ? 'development' : 'production',
        base: '',
        resolve: {
          alias: {
            '@': resolve(__dirname, 'src'),
            '@platform': resolve(__dirname, 'src/platform/chrome'),
          },
        },
        build: {
          outDir: resolve(__dirname, 'dist'),
          emptyOutDir: false,
          sourcemap: isDev,
          rollupOptions: {
            input: {
              'layout-worker': resolve(__dirname, 'src/graph/layout/layout-worker.ts'),
            },
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

// Plugin to build the db-worker as a separate self-contained ES module.
// Chrome extension CSP blocks blob: URLs, so we build the worker separately
// and load it via a direct chrome-extension:// URL.
function dbWorkerPlugin(): Plugin {
  return {
    name: 'db-worker-build',
    apply: 'build',
    closeBundle: async () => {
      await viteBuild({
        configFile: false,
        mode: isDev ? 'development' : 'production',
        base: '',
        resolve: {
          alias: {
            '@': resolve(__dirname, 'src'),
            '@platform': resolve(__dirname, 'src/platform/chrome'),
          },
        },
        build: {
          outDir: resolve(__dirname, 'dist'),
          emptyOutDir: false,
          sourcemap: isDev,
          rollupOptions: {
            input: {
              'db-worker': resolve(__dirname, 'src/db/worker/db-worker.ts'),
            },
            output: {
              entryFileNames: 'db-worker.js',
              // Keep WASM and other assets without hashes for predictable URLs
              assetFileNames: '[name][extname]',
              chunkFileNames: 'assets/[name].js',
              // Inline everything into one file
              manualChunks: undefined,
            },
          },
        },
      });
    },
  };
}

// Plugin to build the db-shared-worker as a separate self-contained ES module.
// SharedWorker ensures only one SQLite handle exists across all tabs/panels.
function dbSharedWorkerPlugin(): Plugin {
  return {
    name: 'db-shared-worker-build',
    apply: 'build',
    closeBundle: async () => {
      await viteBuild({
        configFile: false,
        mode: isDev ? 'development' : 'production',
        base: '',
        resolve: {
          alias: {
            '@': resolve(__dirname, 'src'),
            '@platform': resolve(__dirname, 'src/platform/chrome'),
          },
        },
        build: {
          outDir: resolve(__dirname, 'dist'),
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

// Plugin to move the HTML file and fix asset paths.
// Vite outputs src/ui/index.html -> dist/src/ui/index.html.
// We move it to dist/index.html and fix the asset paths.
function fixHtmlPlugin(): Plugin {
  return {
    name: 'fix-html',
    apply: 'build',
    closeBundle: async () => {
      const nested = resolve(__dirname, 'dist/src/ui/index.html');
      const target = resolve(__dirname, 'dist/index.html');
      try {
        await access(nested);
        let html = await readFile(nested, 'utf-8');
        html = html.replace(/(?:\.\.\/)+assets\//g, 'assets/');
        await writeFile(target, html, 'utf-8');
        await unlink(nested).catch(() => {});
        await rmdir(resolve(__dirname, 'dist/src/ui')).catch(() => {});
        await rmdir(resolve(__dirname, 'dist/src')).catch(() => {});
      } catch {
        // File might already be in the right place
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  isDev = mode === 'development';
  return {
  base: '',
  plugins: [react(), tailwindcss(), fixHtmlPlugin(), dbWorkerPlugin(), dbSharedWorkerPlugin(), layoutWorkerPlugin(), contentScriptPlugin()],
  // Force React to use its production bundle even in dev mode.
  // React's dev bundle uses new Function() for stack traces, which
  // Chrome extension CSP (script-src 'self' 'wasm-unsafe-eval') blocks.
  // Our own code is still unminified + sourcemapped for debugging.
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@platform': resolve(__dirname, 'src/platform/chrome'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    modulePreload: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/ui/index.html'),
        'service-worker': resolve(__dirname, 'src/service-worker/index.ts'),
        offscreen: resolve(__dirname, 'src/offscreen/index.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'service-worker') return 'service-worker.js';
          if (chunkInfo.name === 'offscreen') return 'offscreen.js';
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
};
});
