import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// npm run site (dev server) and npm run site:build (static files for GitHub Pages)
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // served at feelgxxd.github.io/textel/
  base: process.env.SITE_BASE ?? '/textel/',
  build: {
    outDir: fileURLToPath(new URL('../site-dist', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
  },
  // the playground imports the library straight from ../src
  server: { fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } },
});
