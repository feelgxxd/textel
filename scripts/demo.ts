// Renders a few frames files and serves the player demo page: npm run demo
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExample, EXAMPLES } from '../src/examples.ts';
import { recordLoop, stringifyFrames } from '../src/frames.ts';
import { createRenderer } from '../src/render.ts';
import { mergeStyles, type StyleInput } from '../src/style.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
// outside dist, so demo files never end up in the npm package
const framesDir = join(root, '.demo');
mkdirSync(framesDir, { recursive: true });

const FILES: { name: string; example: string; style: StyleInput }[] = [
  { name: 'gem', example: 'gem', style: {} },
  { name: 'rocket-amber', example: 'rocket', style: { color: ['#2a1400', '#ffb000'] } },
  { name: 'donut', example: 'donut', style: { aspect: 1.5 } },
  { name: 'dice-blocks', example: 'dice', style: { charset: 'blocks', color: '#7fdbff' } },
  { name: 'planet-edges', example: 'planet', style: { edges: 'outline', color: ['#0b3d2e', '#39ff88'] } },
];

for (const f of FILES) {
  const ex = EXAMPLES.find((e) => e.name === f.example)!;
  const r = createRenderer(buildExample(ex), mergeStyles(ex.style, { width: 112, height: 56 }, f.style));
  const json = stringifyFrames(recordLoop(r, { frames: 120, meta: { title: ex.title } }));
  writeFileSync(join(framesDir, `${f.name}.textel.json`), json);
  console.log(`rendered ${f.name}.textel.json (${(json.length / 1024).toFixed(0)} KB)`);
}

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json' };
const routes: Record<string, string> = {
  '/': join(root, 'examples', 'player.html'),
  '/textel-player.js': join(root, 'dist', 'textel-player.js'),
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost').pathname;
  let file = routes[url];
  if (!file && url.startsWith('/frames/')) {
    const p = normalize(join(framesDir, url.slice('/frames/'.length)));
    if (p.startsWith(framesDir)) file = p;
  }
  try {
    if (!file) throw new Error('not found');
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

let port = Number(process.env.PORT ?? 5173);
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE' && port < 5200) server.listen(++port, '127.0.0.1');
  else throw e;
});
server.on('listening', () => console.log(`\ndemo: http://127.0.0.1:${port}/  (Ctrl+C to stop)`));
server.listen(port, '127.0.0.1');
