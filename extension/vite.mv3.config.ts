import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// Builds the background service worker or the content script as a single,
// dependency-free IIFE file. Run once per target (see package.json's "dev"
// and "build" scripts, which invoke this config twice with TARGET set).
//
// This can't be one Vite/Rollup build with two inputs: background and
// content both import from ../config and ../types, and Rollup refuses to
// share a chunk between multiple IIFE outputs (IIFE doesn't support
// code-splitting). Two separate single-entry `lib` builds sidestep that.
const targets = {
  background: fileURLToPath(new URL('./src/background/index.ts', import.meta.url)),
  content: fileURLToPath(new URL('./src/content/index.ts', import.meta.url)),
} as const;

const target = process.env.TARGET;
if (target !== 'background' && target !== 'content') {
  throw new Error('Set TARGET=background or TARGET=content before running vite.mv3.config.ts');
}

export default defineConfig({
  publicDir: false,
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: false,
    lib: {
      entry: targets[target],
      formats: ['iife'],
      name: `PageLens_${target}`,
      fileName: () => `${target}.js`,
    },
  },
});
