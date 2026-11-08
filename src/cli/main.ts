#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildExample, EXAMPLES, findExample } from '../examples.ts';
import { parseModel } from '../loaders/index.ts';
import type { Mesh } from '../mesh.ts';
import { toANSI, toText, type ColorDepth } from '../output.ts';
import { createRenderer } from '../render.ts';
import { CHARSETS, mergeStyles, type StyleInput, type Vec3 } from '../style.ts';
import { live } from './live.ts';

const HELP = `textel: 3D models as animated ASCII art

usage
  textel <model.glb|.gltf|.obj|.stl> [options]
  textel --example gem [options]
  textel --list

look
  -c, --chars <ramp|name>   charset name or a custom ramp, darkest first
  -p, --preset <file.json>  style file; flags override it
      --color <#hex>        one color; --color #301000,#ffb000 for a gradient
      --edges               outline the silhouette; --edges depth also marks depth steps
      --light <x,y,z>       direction toward the light (x right, y up, z toward you)
      --ambient <0..1>      brightness floor
      --shading <mode>      auto | flat | smooth

camera
      --pitch <rad>         resting tilt; positive shows the top
      --spin <rad/s>        auto rotation speed (0 = still)
      --zoom <n>            1 fills the screen
      --distance <n>        camera distance in model radii (perspective)
  -s, --size <WxH>          grid size; default: the terminal
  -a, --aspect <n>          character height / width (default 2)

output
      --once                print one frame and exit
      --yaw <rad>           rotation of that frame
      --fps <n>             frame rate for live mode (default 30)
      --no-color            plain characters

keys (live)  ←→↑↓ rotate  +/- zoom  c chars  e edges  l light  space pause  r reset  q quit
`;

function fail(msg: string): never {
  process.stderr.write(`textel: ${msg}\n`);
  process.exit(1);
}

const nums = (s: string, n: number, what: string) => {
  const v = s.split(',').map(Number);
  if (v.length !== n || v.some((x) => !Number.isFinite(x))) fail(`${what} needs ${n} comma separated numbers`);
  return v;
};
const num = (s: string | undefined, what: string) => {
  if (s === undefined) return undefined;
  const v = Number(s);
  if (!Number.isFinite(v)) fail(`${what} is not a number: ${s}`);
  return v;
};

/**
 * `--edges` may come without a value (it then means outline), and values may be negative numbers,
 * which parseArgs would otherwise read as flags: `--pitch -0.3` becomes `--pitch=-0.3`.
 */
function normalizeArgv(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = argv[i + 1];
    if (a === '--edges' && !['outline', 'depth', 'off'].includes(next)) out.push('--edges=outline');
    else if (/^--?[a-z]/i.test(a) && !a.includes('=') && next !== undefined && /^-[\d.]/.test(next)) { out.push(`${a}=${next}`); i++; }
    else out.push(a);
  }
  return out;
}

function main() {
  let args;
  try {
    args = parseArgs({
      args: normalizeArgv(process.argv.slice(2)),
      allowPositionals: true,
      options: {
        example: { type: 'string', short: 'e' },
        list: { type: 'boolean' },
        chars: { type: 'string', short: 'c' },
        preset: { type: 'string', short: 'p' },
        color: { type: 'string' },
        'no-color': { type: 'boolean' },
        edges: { type: 'string' },
        light: { type: 'string' },
        ambient: { type: 'string' },
        shading: { type: 'string' },
        pitch: { type: 'string' },
        spin: { type: 'string' },
        zoom: { type: 'string' },
        distance: { type: 'string' },
        size: { type: 'string', short: 's' },
        aspect: { type: 'string', short: 'a' },
        once: { type: 'boolean' },
        yaw: { type: 'string' },
        fps: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (e) {
    fail((e as Error).message);
  }
  const { values: o, positionals } = args;

  if (o.help) return void process.stdout.write(HELP);
  if (o.version) {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    return void process.stdout.write(pkg.version + '\n');
  }
  if (o.list) {
    process.stdout.write('examples\n');
    for (const e of EXAMPLES) process.stdout.write(`  ${e.name.padEnd(10)} ${e.description}\n`);
    process.stdout.write('\ncharsets\n');
    for (const [k, v] of Object.entries(CHARSETS)) process.stdout.write(`  ${k.padEnd(10)} ${JSON.stringify(v.length > 40 ? v.slice(0, 40) + '…' : v)}\n`);
    return;
  }

  // ---- the model ----
  let mesh: Mesh, name: string, base: StyleInput = {};
  if (o.example) {
    const ex = findExample(o.example) ?? fail(`no example "${o.example}" (have: ${EXAMPLES.map((e) => e.name).join(', ')})`);
    mesh = buildExample(ex);
    name = ex.title;
    base = ex.style;
  } else if (positionals[0]) {
    const file = resolve(positionals[0]);
    let bytes: Uint8Array;
    try { bytes = readFileSync(file); } catch { fail(`cannot read ${positionals[0]}`); }
    try {
      mesh = parseModel(bytes, file, { resolve: (uri) => readFileSync(resolve(dirname(file), uri)) });
    } catch (e) { fail(`${basename(file)}: ${(e as Error).message}`); }
    name = basename(file);
  } else {
    process.stdout.write(HELP);
    return;
  }

  // ---- the style: example look < preset file < flags ----
  let preset: StyleInput = {};
  if (o.preset) {
    try { preset = JSON.parse(readFileSync(resolve(o.preset), 'utf8')); } catch (e) { fail(`preset: ${(e as Error).message}`); }
  }
  const flags: StyleInput = {};
  if (o.chars !== undefined) {
    if (CHARSETS[o.chars]) { flags.charset = o.chars; flags.chars = undefined; } else flags.chars = o.chars;
  }
  if (o.color) flags.color = o.color.includes(',') ? o.color.split(',') : o.color;
  if (o.edges !== undefined) {
    if (o.edges !== 'outline' && o.edges !== 'depth' && o.edges !== 'off') fail('--edges is outline, depth or off');
    flags.edges = o.edges === 'off' ? false : o.edges;
  }
  if (o.light) flags.light = nums(o.light, 3, '--light') as Vec3;
  if (o.shading) {
    if (o.shading !== 'auto' && o.shading !== 'flat' && o.shading !== 'smooth') fail('--shading is auto, flat or smooth');
    flags.shading = o.shading;
  }
  flags.ambient = num(o.ambient, '--ambient');
  flags.pitch = num(o.pitch, '--pitch');
  flags.spin = num(o.spin, '--spin');
  flags.zoom = num(o.zoom, '--zoom');
  flags.distance = num(o.distance, '--distance');
  flags.aspect = num(o.aspect, '--aspect');
  let fixedSize: [number, number] | null = null;
  if (o.size) {
    const m = /^(\d+)x(\d+)$/i.exec(o.size) ?? fail('--size looks like 112x56');
    fixedSize = [+m[1], +m[2]];
  }
  // a ramp given with -c replaces the example's charset too
  if (flags.chars !== undefined) base = { ...base, charset: undefined };
  const style = mergeStyles(base, preset, flags);

  const tty = !!process.stdout.isTTY;
  const env = process.env;
  const depth: ColorDepth = o['no-color'] || env.NO_COLOR ? 'none'
    : !tty && !env.FORCE_COLOR ? 'none'
    : env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit' || env.WT_SESSION || env.TERM_PROGRAM === 'vscode' || env.TERM_PROGRAM === 'iTerm.app' ? 'truecolor'
    : '256';

  if (o.once || !tty || !process.stdin.isTTY) {
    const [w, h] = fixedSize ?? (tty ? [process.stdout.columns, Math.max(5, process.stdout.rows - 1)] : [80, 40]);
    let r;
    try { r = createRenderer(mesh, { ...style, width: w, height: h }); } catch (e) { fail((e as Error).message); }
    const frame = r.render({ yaw: num(o.yaw, '--yaw') ?? 0.6 });
    process.stdout.write((depth === 'none' ? toText(frame) : toANSI(frame, depth).join('\n')) + '\n');
    return;
  }

  live({ mesh, name, style, fixedSize, depth, fps: num(o.fps, '--fps') ?? 30 });
}

main();
