// Pieces every command shares: argument parsing, model input, style flags, color detection.
import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { buildExample, EXAMPLES, findExample } from '../examples.ts';
import { parseModel } from '../loaders/index.ts';
import type { Mesh } from '../mesh.ts';
import type { ColorDepth } from '../output.ts';
import { detectColorDepth } from '../terminal.ts';
import { CHARSETS, mergeStyles, type EdgeMode, type StyleInput, type Vec3 } from '../style.ts';

export function fail(msg: string): never {
  process.stderr.write(`textel: ${msg}\n`);
  process.exit(1);
}

export const num = (s: string | undefined, what: string) => {
  if (s === undefined) return undefined;
  const v = Number(s);
  if (!Number.isFinite(v)) fail(`${what} is not a number: ${s}`);
  return v;
};

const nums = (s: string, n: number, what: string) => {
  const v = s.split(',').map(Number);
  if (v.length !== n || v.some((x) => !Number.isFinite(x))) fail(`${what} needs ${n} comma separated numbers`);
  return v;
};

/**
 * `--edges` may come without a value (it then means outline), and values may be negative numbers,
 * which parseArgs would otherwise read as flags: `--pitch -0.3` becomes `--pitch=-0.3`.
 */
export function normalizeArgv(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = argv[i + 1];
    if (a === '--edges' && !['outline', 'depth', 'crease', 'off'].includes(next)) out.push('--edges=outline');
    else if (/^--?[a-z]/i.test(a) && !a.includes('=') && next !== undefined && /^-[\d.]/.test(next)) { out.push(`${a}=${next}`); i++; }
    else out.push(a);
  }
  return out;
}

type Options = NonNullable<ParseArgsConfig['options']>;

/** where the model comes from */
export const INPUT_OPTIONS = {
  example: { type: 'string', short: 'e' },
} satisfies Options;

/** everything that changes the look; all of it can also come from a preset file */
export const STYLE_OPTIONS = {
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
} satisfies Options;

export const HELP_OPTIONS = {
  help: { type: 'boolean', short: 'h' },
} satisfies Options;

export const INPUT_HELP = `input
  <model>                   a .glb, .gltf, .obj or .stl file
  -e, --example <name>      a built-in scene instead (textel list)`;

export const STYLE_HELP = `look
  -c, --chars <ramp|name>   charset name or a custom ramp, darkest first
  -p, --preset <file.json>  style file; flags override it
      --color <#hex>        one color; --color #301000,#ffb000 for a gradient; model for its own
      --no-color            plain characters
      --edges [mode]        outline the silhouette; depth also marks depth steps;
                            crease also folds of the surface; off
      --light <x,y,z>       direction toward the light (x right, y up, z toward you)
      --ambient <0..1>      brightness floor
      --shading <mode>      auto | flat | smooth

camera
      --pitch <rad>         resting tilt; positive shows the top
      --spin <rad/s>        auto rotation speed (0 = still)
      --zoom <n>            1 fills the grid
      --distance <n>        camera distance in model radii (perspective)
  -s, --size <WxH>          grid size
  -a, --aspect <n>          character height / width (default 2)`;

/** parseArgs with our argv fixes; errors become a clean message */
export function parse<O extends Options>(argv: string[], options: O) {
  try {
    return parseArgs({ args: normalizeArgv(argv), allowPositionals: true, options, strict: true });
  } catch (e) {
    fail((e as Error).message);
  }
}

type StyleValues = { [K in keyof typeof STYLE_OPTIONS]?: (typeof STYLE_OPTIONS)[K]['type'] extends 'boolean' ? boolean : string };
type InputValues = { example?: string };

export interface Input {
  mesh: Mesh;
  /** shown in status lines and metadata */
  name: string;
  /** the example's own look, if it is one */
  style: StyleInput;
}

/** the model from `--example` or the first positional; null when neither was given */
export function loadInput(values: InputValues, positionals: string[]): Input | null {
  if (values.example) {
    const ex = findExample(values.example) ?? fail(`no example "${values.example}" (have: ${EXAMPLES.map((e) => e.name).join(', ')})`);
    return { mesh: buildExample(ex), name: ex.title, style: ex.style };
  }
  const arg = positionals[0];
  if (!arg) return null;
  const file = resolve(arg);
  let bytes: Uint8Array;
  try { bytes = readFileSync(file); } catch { fail(`cannot read ${arg}`); }
  try {
    return { mesh: parseModel(bytes, file, { resolve: (uri) => readFileSync(resolve(dirname(file), uri)) }), name: basename(file), style: {} };
  } catch (e) {
    fail(`${basename(file)}: ${(e as Error).message}`);
  }
}

/** true when `--color model` asks for colors this model keeps in image textures, which are not read yet */
export const missingTextures = (mesh: Mesh, style: StyleInput) => !!mesh.textured && style.color === 'model';

export const TEXTURE_NOTE = "textel: note: this model's colors come from image textures, which textel does not read yet; those parts are drawn in their plain material color\n";

/** `--size WxH`, or null */
export function parseSize(s: string | undefined): [number, number] | null {
  if (!s) return null;
  const m = /^(\d+)x(\d+)$/i.exec(s) ?? fail('--size looks like 112x56');
  return [+m[1], +m[2]];
}

/** the final style: the example's look < preset file < flags */
export function styleFrom(o: StyleValues, base: StyleInput): StyleInput {
  let preset: StyleInput = {};
  if (o.preset) {
    try { preset = JSON.parse(readFileSync(resolve(o.preset), 'utf8')); } catch (e) { fail(`preset: ${(e as Error).message}`); }
  }
  const flags: StyleInput = {};
  if (o.chars !== undefined) {
    if (CHARSETS[o.chars]) flags.charset = o.chars;
    else flags.chars = o.chars;
  }
  if (o.color) flags.color = o.color.includes(',') ? o.color.split(',') : o.color;
  if (o.edges !== undefined) {
    if (!['outline', 'depth', 'crease', 'off'].includes(o.edges)) fail('--edges is outline, depth, crease or off');
    flags.edges = o.edges === 'off' ? false : (o.edges as EdgeMode);
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
  const size = parseSize(o.size);
  if (size) [flags.width, flags.height] = size;
  // a custom ramp from -c replaces the example's charset as well
  const b = flags.chars !== undefined ? { ...base, charset: undefined } : base;
  return mergeStyles(b, preset, flags);
}

/** what stdout can show, honoring NO_COLOR / FORCE_COLOR and --no-color */
export function colorDepth(noColor: boolean | undefined): ColorDepth {
  return noColor ? 'none' : detectColorDepth(process.stdout);
}
