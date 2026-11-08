// Renders a few frames files and serves the demo pages: npm run demo
// HOST=0.0.0.0 npm run demo makes them reachable from other devices on the network (a phone).
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExample, EXAMPLES } from '../src/examples.ts';
import { recordLoop, stringifyFrames } from '../src/frames.ts';
import { createRenderer } from '../src/render.ts';
import type { Mesh } from '../src/mesh.ts';
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

// the examples as .obj files, so the viewer loads them like any model file
const modelsDir = join(framesDir, 'models');
mkdirSync(modelsDir, { recursive: true });
function toOBJ(m: Mesh): string {
  const out: string[] = [];
  for (let i = 0; i < m.positions.length; i += 3) out.push(`v ${m.positions[i].toFixed(4)} ${m.positions[i + 1].toFixed(4)} ${m.positions[i + 2].toFixed(4)}`);
  if (m.normals) for (let i = 0; i < m.normals.length; i += 3) out.push(`vn ${m.normals[i].toFixed(3)} ${m.normals[i + 1].toFixed(3)} ${m.normals[i + 2].toFixed(3)}`);
  let mat = -1;
  for (let t = 0; t < m.indices.length / 3; t++) {
    if (m.triMaterial[t] !== mat) { mat = m.triMaterial[t]; out.push(`usemtl ${m.materials[mat]}`); }
    const f = [0, 1, 2].map((k) => m.indices[t * 3 + k] + 1).map((v) => (m.normals ? `${v}//${v}` : String(v)));
    out.push(`f ${f.join(' ')}`);
  }
  return out.join('\n') + '\n';
}
for (const ex of EXAMPLES) writeFileSync(join(modelsDir, `${ex.name}.obj`), toOBJ(buildExample(ex)));
console.log(`wrote ${EXAMPLES.length} example models as .obj`);

// the output benchmark page's script
await build({ entryPoints: [join(root, 'scripts', 'bench-dom.ts')], outfile: join(framesDir, 'bench.js'), bundle: true, format: 'esm', minify: true, target: 'es2022', define: { BUILT: JSON.stringify(new Date().toISOString()) } });

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.obj': 'text/plain' };
const routes: Record<string, string> = {
  '/': join(root, 'examples', 'player.html'),
  '/viewer': join(root, 'examples', 'viewer.html'),
  '/bench': join(root, 'examples', 'bench.html'),
  '/textel-player.js': join(root, 'dist', 'textel-player.js'),
  '/textel-viewer.js': join(root, 'dist', 'textel-viewer.js'),
  '/bench.js': join(framesDir, 'bench.js'),
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

const host = process.env.HOST ?? '127.0.0.1';
let port = Number(process.env.PORT ?? 5173);
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE' && port < 5200) server.listen(++port, host);
  else throw e;
});
server.on('listening', () => {
  // on 0.0.0.0, list the addresses other devices can use
  const hosts = host === '0.0.0.0'
    ? Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a!.address)
    : [host];
  for (const h of hosts) console.log(`\nplayer demo: http://${h}:${port}/\nviewer demo: http://${h}:${port}/viewer\nbenchmark:   http://${h}:${port}/bench`);
  console.log('(Ctrl+C to stop)');
});
server.listen(port, host);
