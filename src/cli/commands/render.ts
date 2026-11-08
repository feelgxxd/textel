import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { recordLoop, stringifyFrames } from '../../frames.ts';
import { recordingSVG } from '../../svg.ts';
import { createRenderer } from '../../render.ts';
import { mergeStyles } from '../../style.ts';
import { fail, HELP_OPTIONS, INPUT_HELP, INPUT_OPTIONS, loadInput, num, parse, STYLE_HELP, STYLE_OPTIONS, styleFrom } from '../shared.ts';

export const summary = 'record a spinning loop into a .textel.json file or an animated .svg';

export const HELP = `textel render: record a spinning loop into a .textel.json file or an animated .svg

usage
  textel render <model> [-o out.textel.json | out.svg] [options]
  textel render --example <name> [options]

${INPUT_HELP}

recording
  -o, --out <file>          output file (default: <name>.textel.json here); a .svg file
                            is an animated image that plays anywhere, a GitHub README too
      --frames <n>          frames in the loop (default 120)
      --fps <n>             playback rate (default 30)
      --turns <n>           turns over the loop; negative spins the other way (default 1)
      --force               overwrite an existing file

${STYLE_HELP}

  the grid defaults to 112x56 at aspect 2 (terminals); for a web page pass the
  aspect of its font, for example --aspect 1.5
`;

const OPTIONS = {
  ...INPUT_OPTIONS,
  ...STYLE_OPTIONS,
  ...HELP_OPTIONS,
  out: { type: 'string', short: 'o' },
  frames: { type: 'string' },
  fps: { type: 'string' },
  turns: { type: 'string' },
  force: { type: 'boolean' },
} as const;

const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

function version(): string {
  return JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version;
}

export function run(argv: string[]) {
  const { values: o, positionals } = parse(argv, OPTIONS);
  if (o.help) return void process.stdout.write(HELP);
  if (positionals.length > 1) fail(`unexpected argument "${positionals[1]}"`);
  const input = loadInput(o, positionals);
  if (!input) return void process.stdout.write(HELP);

  const frames = num(o.frames, '--frames') ?? 120, fps = num(o.fps, '--fps') ?? 30, turns = num(o.turns, '--turns') ?? 1;
  if (!(frames >= 1 && frames <= 10000 && Number.isInteger(frames))) fail('--frames is a whole number from 1 to 10000');
  if (!(fps > 0 && fps <= 120)) fail('--fps is between 0 and 120');
  if (turns === 0) fail('--turns cannot be 0');

  const stem = o.example ? o.example.toLowerCase() : basename(positionals[0], extname(positionals[0]));
  const out = resolve(o.out ?? `${stem}.textel.json`);
  if (existsSync(out) && !o.force) fail(`${basename(out)} exists; pass --force to overwrite`);

  const flags = styleFrom(o, input.style);
  const style = mergeStyles({ width: 112, height: 56, aspect: 2 }, flags);
  let renderer;
  try { renderer = createRenderer(input.mesh, style); } catch (e) { fail((e as Error).message); }

  const progress = process.stderr.isTTY;
  const t0 = performance.now();
  let shown = -1;
  const { width: _w, height: _h, ...look } = style;
  const rec = recordLoop(renderer, {
    frames, fps, turns,
    // enough to render the same file again
    meta: { title: input.name, generator: `textel ${version()}`, turns, style: look },
    onFrame: (i, total) => {
      const pct = Math.floor((i / total) * 100);
      if (!progress || pct === shown) return;
      shown = pct;
      process.stderr.write(`\rrendering ${i}/${total} (${pct}%)`);
    },
  });
  const text = /\.svg$/i.test(out) ? recordingSVG(rec, { title: input.name }) : stringifyFrames(rec);
  writeFileSync(out, text);
  if (progress) process.stderr.write('\r\x1b[K');
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  process.stderr.write(`wrote ${basename(out)}: ${frames} frames, ${rec.width}x${rec.height}, ${kb(text.length)} (${kb(gzipSync(text).length)} gzipped), ${secs}s\n`);
}
