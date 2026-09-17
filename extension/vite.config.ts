import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// Builds the popup as a normal Vite HTML entry (src/popup/index.html).
// Background and content scripts are built separately by vite.mv3.config.ts
// because they must ship as single self-contained IIFE files (no ES module
// imports at runtime) for Chrome to load as a service worker / content
// script. See README.md and CLAUDE.md for the full rationale.
export default defineConfig({
  root: fileURLToPath(new URL('./src/popup', import.meta.url)),
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
  },
});
