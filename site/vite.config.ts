import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { footer, header, type Page } from './build/chrome.ts';
import { docsPage } from './build/docs.ts';

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

/** fills docs/index.html with the guide, the CLI and API references and the format spec */
function docs(): Plugin {
  return {
    name: 'textel-docs',
    transformIndexHtml(html) {
      // the shared header and footer: <!--textel-header:page:root--> and <!--textel-footer-->
      const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
      html = html
        .replace(/<!--textel-header:(\w+):([^>]*?)-->/, (_, page: Page, root: string) => header(page, root))
        .replace('<!--textel-footer-->', () => footer(version));
      if (!html.includes('<!--textel-docs-->')) return html;
      const { body, toc } = docsPage();
      return html.replace('<!--textel-docs-->', () => body).replace('<!--textel-toc-->', () => toc);
    },
  };
}

// npm run site (dev server) and npm run site:build (static files for GitHub Pages)
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // served at feelgxxd.github.io/textel/
  base: process.env.SITE_BASE ?? '/textel/',
  plugins: [playerSource(), docs()],
  build: {
    outDir: fileURLToPath(new URL('../site-dist', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: { input: { main: fileURLToPath(new URL('index.html', import.meta.url)), docs: fileURLToPath(new URL('docs/index.html', import.meta.url)) } },
    target: 'es2022',
  },
  // the playground imports the library straight from ../src
  server: { fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } },
});
