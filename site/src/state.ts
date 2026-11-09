// Playground state and everything derived from it that does not touch the DOM:
// share links, embed snippets, CLI commands. Tested in test/site.test.ts.
import { CHARSETS, type StyleInput, type Vec3 } from '../../src/style.ts';

export const VERSION = '0.5';
export const CDN = `https://cdn.jsdelivr.net/npm/@feelgxxd/textel@${VERSION}/dist`;

/** colors of the box around the picture, used by the preview and by the embed snippets */
export interface Page {
  fg: string;
  bg: string;
}

export interface State {
  look: StyleInput;
  /** grid width of the live preview, in characters */
  cols: number;
  page: Page;
  /** the built-in example being shown, so a shared link can show it too */
  example?: string;
}

export const DEFAULT_STATE: State = {
  look: { charset: 'hard', pitch: 0.3, spin: 0.66, light: [-0.3, 0.35, 0.88] },
  cols: 96,
  page: { fg: '#e8e8e8', bg: '#111214' },
  example: 'gem',
};

export interface Preset {
  name: string;
  look: StyleInput;
  page: Page;
}

/** starting points; each replaces the look but keeps the camera */
export const PRESETS: Preset[] = [
  { name: 'Plain', look: { charset: 'hard', color: undefined, edges: false }, page: { fg: '#e8e8e8', bg: '#111214' } },
  { name: 'Terminal green', look: { charset: 'classic', color: ['#04260f', '#39ff88'], edges: false }, page: { fg: '#39ff88', bg: '#020a05' } },
  { name: 'Amber CRT', look: { charset: 'hard', color: ['#2a1400', '#ffb000'], edges: false }, page: { fg: '#ffb000', bg: '#120a02' } },
  { name: 'Blueprint', look: { charset: 'minimal', color: '#cfe3ff', edges: 'depth' }, page: { fg: '#cfe3ff', bg: '#0b2a55' } },
  { name: 'Ink on paper', look: { charset: 'detailed', color: undefined, edges: false }, page: { fg: '#1d1b16', bg: '#f3efe4' } },
  { name: 'Blocks', look: { charset: 'blocks', color: ['#0b2230', '#7fdbff'], edges: false }, page: { fg: '#7fdbff', bg: '#071118' } },
];

/** light direction from two angles in degrees: around the model, and above it */
export function lightFromAngles(azimuth: number, elevation: number): Vec3 {
  const a = (azimuth * Math.PI) / 180, e = (elevation * Math.PI) / 180;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return [r(Math.sin(a) * Math.cos(e)), r(Math.sin(e)), r(Math.cos(a) * Math.cos(e))];
}

export function anglesFromLight([x, y, z]: Vec3): [number, number] {
  const l = Math.hypot(x, y, z) || 1;
  return [Math.round((Math.atan2(x, z) * 180) / Math.PI), Math.round((Math.asin(y / l) * 180) / Math.PI)];
}

// ---------- share links ----------

const toB64url = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/**
 * The whole state as a URL hash: `#z.` + deflated JSON, or `#j.` + plain JSON where the browser
 * cannot compress. The model itself is never in the link.
 */
export async function encodeState(s: State): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(s));
  if (typeof CompressionStream === 'function') return 'z.' + toB64url(await pipe(json, new CompressionStream('deflate-raw')));
  return 'j.' + toB64url(json);
}

/** null for an empty or broken hash; a broken link must never break the page */
export async function decodeState(hash: string): Promise<State | null> {
  const h = hash.replace(/^#/, '');
  try {
    let bytes: Uint8Array;
    if (h.startsWith('z.')) bytes = await pipe(fromB64url(h.slice(2)), new DecompressionStream('deflate-raw'));
    else if (h.startsWith('j.')) bytes = fromB64url(h.slice(2));
    else return null;
    const s = JSON.parse(new TextDecoder().decode(bytes));
    if (!s || typeof s !== 'object' || typeof s.look !== 'object') return null;
    return { ...DEFAULT_STATE, ...s, page: { ...DEFAULT_STATE.page, ...s.page } };
  } catch {
    return null;
  }
}

// ---------- snippets ----------

/** fields the elements and the CLI take directly; anything else needs a preset file */
const SIMPLE = new Set(['charset', 'chars', 'color', 'edges', 'spin', 'pitch', 'zoom', 'distance', 'ambient']);

/** true when the look uses fields only a preset file can carry (materials, light, shading, ...) */
export function needsPreset(look: StyleInput): boolean {
  return Object.entries(look).some(([k, v]) => v !== undefined && !SIMPLE.has(k));
}

/** the look as a preset file, without empty fields */
export function presetJSON(look: StyleInput): string {
  const clean = Object.fromEntries(Object.entries(look).filter(([, v]) => v !== undefined));
  return JSON.stringify(clean, null, 2) + '\n';
}

const attr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

function lookAttributes(look: StyleInput): string {
  const out: string[] = [];
  if (look.chars !== undefined) out.push(`chars="${attr(look.chars)}"`);
  else if (look.charset) out.push(`charset="${attr(look.charset)}"`);
  if (look.color !== undefined && look.color !== 'none') {
    const c = Array.isArray(look.color) ? look.color.join(',') : typeof look.color === 'string' ? look.color : null;
    if (c) out.push(`color="${attr(c)}"`);
  }
  if (look.edges) out.push(look.edges === 'outline' || look.edges === true ? 'edges' : `edges="${look.edges}"`);
  for (const k of ['pitch', 'spin', 'zoom', 'distance', 'ambient'] as const) {
    if (look[k] !== undefined) out.push(`${k}="${look[k]}"`);
  }
  return out.join(' ');
}

const boxStyle = (page: Page) => `style="color:${page.fg};background:${page.bg}"`;

/** HTML for a page: the live viewer, or the player for a recorded file */
export function embedSnippet(s: State, kind: 'viewer' | 'player', file: string): string {
  if (kind === 'player') {
    return `<script type="module" src="${CDN}/textel-player.js"></script>\n<textel-player src="${attr(file)}" ${boxStyle(s.page)}></textel-player>\n`;
  }
  const preset = needsPreset(s.look) ? ' preset="look.json"' : '';
  const attrs = [lookAttributes(s.look), s.cols !== 96 ? `cols="${s.cols}"` : ''].filter(Boolean).join(' ');
  return `<script type="module" src="${CDN}/textel-viewer.js"></script>\n<textel-viewer src="${attr(file)}"${preset}${attrs ? ' ' + attrs : ''} ${boxStyle(s.page)}></textel-viewer>\n`;
}

const shellQuote = (v: string) => (/^[\w.,#/:+-]+$/.test(v) ? v : `"${v.replace(/(["\\$`])/g, '\\$1')}"`);

/** the same look from the terminal; `render` records a file for the player */
export function cliCommand(s: State, kind: 'preview' | 'render', file: string): string {
  const look = s.look, parts = ['npx', '@feelgxxd/textel'];
  if (kind === 'render') parts.push('render');
  parts.push(shellQuote(file));
  if (needsPreset(look)) parts.push('--preset', 'look.json');
  if (look.chars !== undefined) parts.push('--chars', shellQuote(look.chars));
  else if (look.charset) parts.push('--chars', look.charset);
  if (look.color !== undefined && look.color !== 'none') {
    const c = Array.isArray(look.color) ? look.color.join(',') : typeof look.color === 'string' ? look.color : null;
    if (c) parts.push('--color', shellQuote(c));
  }
  if (look.edges) parts.push('--edges', look.edges === true ? 'outline' : look.edges);
  for (const k of ['pitch', 'spin', 'zoom', 'distance', 'ambient'] as const) {
    if (look[k] !== undefined) parts.push(`--${k}`, String(look[k]));
  }
  if (kind === 'render') parts.push('-o', shellQuote(file.replace(/\.[a-z0-9]+$/i, '') + '.textel.json'));
  return parts.join(' ');
}

export const CHARSET_NAMES = Object.keys(CHARSETS);

/**
 * One HTML file that plays a recorded loop with nothing else: the player and the frames are inside it,
 * so it opens from a disk, an email or a USB stick, offline. `ratio` is the loop's width over height.
 */
export function standaloneHTML(frames: string, player: string, opts: { title: string; page: Page; ratio: number }): string {
  // nothing inside may close the script early
  const safe = (js: string) => js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
  const text = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const r = Math.round(opts.ratio * 1000) / 1000;
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${text(opts.title)}</title>
<style>
html,body{margin:0;height:100%;background:${opts.page.bg};color:${opts.page.fg}}
body{display:grid;place-items:center}
textel-player{width:min(94vw,${r}*94vh)}
</style>
<textel-player label="${attr(opts.title)}"></textel-player>
<script type="module">
${safe(player)}
document.querySelector('textel-player').recording = ${safe(frames)};
</script>
`;
}
