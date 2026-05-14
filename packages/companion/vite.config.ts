import { defineConfig } from 'vite';
import { resolve } from 'path';
import { build as viteBuild } from 'vite';
import { copyFileSync, existsSync } from 'fs';

function contentCapturePlugin() {
  return {
    name: 'content-capture-build',
    apply: 'build' as const,
    closeBundle: async () => {
      await viteBuild({
        configFile: false,
        publicDir: false,
        build: {
          outDir: resolve(__dirname, '../../dist-companion'),
          emptyOutDir: false,
          lib: {
            entry: resolve(__dirname, 'content-capture.ts'),
            name: 'contentCapture',
            formats: ['iife'],
            fileName: () => 'content-capture.js',
          },
          rollupOptions: {
            output: { extend: true },
          },
        },
      });
    },
  };
}

function popupPlugin() {
  return {
    name: 'popup-build',
    apply: 'build' as const,
    closeBundle: async () => {
      await viteBuild({
        configFile: false,
        publicDir: false,
        build: {
          outDir: resolve(__dirname, '../../dist-companion'),
          emptyOutDir: false,
          lib: {
            entry: resolve(__dirname, 'popup.ts'),
            name: 'popup',
            formats: ['iife'],
            fileName: () => 'popup.js',
          },
          rollupOptions: {
            output: { extend: true },
          },
        },
      });
    },
  };
}

function copyStaticPlugin() {
  return {
    name: 'copy-static',
    apply: 'build' as const,
    closeBundle: () => {
      copyFileSync(
        resolve(__dirname, 'manifest.json'),
        resolve(__dirname, '../../dist-companion/manifest.json')
      );
      const popupHtml = resolve(__dirname, 'popup.html');
      if (existsSync(popupHtml)) {
        copyFileSync(popupHtml, resolve(__dirname, '../../dist-companion/popup.html'));
      }
    },
  };
}

export default defineConfig({
  publicDir: false,
  build: {
    outDir: resolve(__dirname, '../../dist-companion'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'service-worker': resolve(__dirname, 'service-worker.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        format: 'es',
      },
    },
  },
  plugins: [contentCapturePlugin(), popupPlugin(), copyStaticPlugin()],
});
