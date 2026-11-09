import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { defineConfig, type Plugin } from 'vite';

const PLAYER = 'virtual:textel-player';

/** the <textel-player> bundle as a string, so a single-file HTML export can carry the player inside */
function playerSource(): Plugin {
  return {
    name: 'textel-player-source',
    resolveId: (id) => (id === PLAYER ? '\0' + PLAYER : undefined),
    async load(id) {
      if (id !== '\0' + PLAYER) return;
      const entry = fileURLToPath(new URL('../src/browser/player.ts', import.meta.url));
      const out = await build({ entryPoints: [entry], bundle: true, minify: true, format: 'esm', target: 'es2022', write: false, metafile: true });
      // rebuild when the player changes during development (input paths are relative to the working directory)
      for (const f of Object.keys(out.metafile.inputs)) this.addWatchFile(resolve(f));
      return `export default ${JSON.stringify(out.outputFiles[0].text)};`;
    },
  };
}

// npm run site (dev server) and npm run site:build (static files for GitHub Pages)
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // served at feelgxxd.github.io/textel/
  base: process.env.SITE_BASE ?? '/textel/',
  plugins: [playerSource()],
  build: {
    outDir: fileURLToPath(new URL('../site-dist', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
  },
  // the playground imports the library straight from ../src
  server: { fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } },
});
