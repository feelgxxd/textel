// How big frames files get: node bench/frames-size.ts [frames] [WxH]
// Compares the JSON + base64 container against a raw binary layout, under gzip and brotli.
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { buildExample, EXAMPLES } from '../src/examples.ts';
import { encodeStream, parseFrames, recordLoop, stringifyFrames, toFramesFile } from '../src/frames.ts';
import { createRenderer } from '../src/render.ts';
import { mergeStyles, type StyleInput } from '../src/style.ts';

const N = Number(process.argv[2] ?? 120);
const [W, H] = (process.argv[3] ?? '112x56').split('x').map(Number);
const kb = (n: number) => (n / 1024).toFixed(1).padStart(7);
const VARIANTS: [string, StyleInput][] = [
  ['plain', {}],
  ['gradient', { color: ['#301000', '#ffb000'] }],
  ['edges', { edges: 'outline' }],
];

console.log(`${N} frames at ${W}x${H}, sizes in KB\n`);
console.log('example   variant    text     json  json.gz  json.br      bin   bin.gz   bin.br   enc ms   dec ms');
const totals = new Map<string, number[]>();
for (const e of EXAMPLES) {
  const mesh = buildExample(e);
  for (const [name, extra] of VARIANTS) {
    const r = createRenderer(mesh, mergeStyles(e.style, { width: W, height: H }, extra));
    const rec = recordLoop(r, { frames: N });
    const t0 = performance.now();
    const json = stringifyFrames(rec);
    const t1 = performance.now();
    parseFrames(json);
    const t2 = performance.now();
    // binary: the same header without `data`, then the raw stream
    const { data: _, ...header } = toFramesFile(rec);
    const bin = Buffer.concat([Buffer.from(JSON.stringify(header)), Buffer.from(encodeStream(rec))]);
    const text = N * (W + 1) * H;
    const row = [text, json.length, gzipSync(json).length, brotliCompressSync(json).length, bin.length, gzipSync(bin).length, brotliCompressSync(bin).length];
    const t = totals.get(name) ?? row.map(() => 0);
    totals.set(name, t.map((v, i) => v + row[i]));
    console.log(`${e.name.padEnd(9)} ${name.padEnd(9)}${row.map(kb).join('  ')}  ${(t1 - t0).toFixed(0).padStart(7)}  ${(t2 - t1).toFixed(0).padStart(7)}`);
  }
}
console.log('\naverage');
for (const [name, t] of totals) console.log(`          ${name.padEnd(9)}${t.map((v) => kb(v / EXAMPLES.length)).join('  ')}`);
