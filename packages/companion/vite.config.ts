import { defineConfig } from 'vite';
import { resolve } from 'path';
import { build as viteBuild } from 'vite';
import { copyFileSync } from 'fs';

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

function copyManifestPlugin() {
  return {
    name: 'copy-manifest',
    apply: 'build' as const,
    closeBundle: () => {
      copyFileSync(
        resolve(__dirname, 'manifest.json'),
        resolve(__dirname, '../../dist-companion/manifest.json')
      );
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
  plugins: [contentCapturePlugin(), copyManifestPlugin()],
});
