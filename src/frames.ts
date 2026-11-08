// Frames files: a looped animation rendered once and stored compactly, so it can be played
// without the renderer. See docs/format.md for the byte layout.
import { bg, FAINT, fg, line, type ColorDepth } from './ansi.ts';
import { cellColor } from './output.ts';
import type { Frame, Renderer } from './render.ts';
import type { RGB } from './style.ts';

export const FORMAT_VERSION = 1;
export const ENCODING = 'rle-delta-1';

/**
 * Cell styles, by index. `""` is the default color, `"~"` the default color dimmed,
 * `"#rrggbb"` a color. Index 0 is always `""`.
 */
export type CellStyle = string;

/** A recorded animation in memory: per frame, one glyph index and one style index per cell. */
export interface Recording {
  width: number;
  height: number;
  aspect: number;
  fps: number;
  glyphs: string[];
  /** null when no cell has a color or dim style */
  styles: CellStyle[] | null;
  /** background color of the original style, if it had one */
  bg: string | null;
  frames: { glyph: Uint16Array; style: Uint16Array | null }[];
  meta: Record<string, unknown>;
}

/** The JSON container. */
export interface FramesFile {
  textel: number;
  encoding: string;
  width: number;
  height: number;
  aspect: number;
  fps: number;
  frameCount: number;
  glyphs: string[];
  styles?: CellStyle[];
  bg?: string;
  /** base64 of the encoded stream */
  data: string;
  meta?: Record<string, unknown>;
}

export interface RecordOptions {
  /** frames in one full turn (default 120) */
  frames?: number;
  /** playback rate (default 30) */
  fps?: number;
  /** turns over the whole loop; negative spins the other way (default 1) */
  turns?: number;
  /** starting yaw, radians */
  yaw?: number;
  /** colors are rounded to multiples of this per channel, which keeps the palette small (default 8) */
  colorStep?: number;
  meta?: Record<string, unknown>;
  /** called after each frame, for progress */
  onFrame?: (done: number, total: number) => void;
}

const hex = (c: RGB) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** Renders a seamless turntable loop: the last frame leads straight back into the first. */
export function recordLoop(renderer: Renderer, opts: RecordOptions = {}): Recording {
  const n = Math.max(1, Math.round(opts.frames ?? 120)), turns = opts.turns ?? 1, yaw0 = opts.yaw ?? 0;
  const rec = new RecordingBuilder(opts.colorStep ?? 8);
  for (let i = 0; i < n; i++) {
    rec.add(renderer.render({ yaw: yaw0 + (i / n) * turns * Math.PI * 2 }));
    opts.onFrame?.(i + 1, n);
  }
  return rec.build(opts.fps ?? 30, opts.meta ?? {});
}

/** Collects rendered frames into palettes and indices. */
export class RecordingBuilder {
  private glyphs = new Map<string, number>([[' ', 0]]);
  private styles = new Map<string, number>([['', 0]]);
  private frames: Recording['frames'] = [];
  private first: Frame | null = null;
  private step: number;

  constructor(colorStep = 8) {
    this.step = Math.max(1, colorStep);
  }

  add(frame: Frame) {
    if (!this.first) this.first = frame;
    else if (frame.width !== this.first.width || frame.height !== this.first.height) throw new Error('all frames must have the same size');
    const n = frame.width * frame.height, glyph = new Uint16Array(n), style = new Uint16Array(n);
    const q = (v: number) => Math.round(v / this.step) * this.step;
    for (let i = 0; i < n; i++) {
      const ch = frame.chars[i];
      let g = this.glyphs.get(ch);
      if (g === undefined) { g = this.glyphs.size; this.glyphs.set(ch, g); }
      glyph[i] = g;
      if (ch === ' ') continue;
      const { rgb, faint } = cellColor(frame, i);
      const key = rgb ? hex([q(rgb[0]), q(rgb[1]), q(rgb[2])]) : faint ? '~' : '';
      let s = this.styles.get(key);
      if (s === undefined) { s = this.styles.size; this.styles.set(key, s); }
      style[i] = s;
    }
    if (this.glyphs.size > 0xffff || this.styles.size > 0xffff) throw new Error('too many distinct glyphs or colors');
    this.frames.push({ glyph, style });
  }

  build(fps: number, meta: Record<string, unknown>): Recording {
    const f = this.first;
    if (!f) throw new Error('no frames recorded');
    const styled = this.styles.size > 1;
    const bg = f.style.color.bg;
    return {
      width: f.width,
      height: f.height,
      aspect: f.style.aspect,
      fps,
      glyphs: [...this.glyphs.keys()],
      styles: styled ? [...this.styles.keys()] : null,
      bg: bg ? hex(bg) : null,
      frames: this.frames.map((fr) => ({ glyph: fr.glyph, style: styled ? fr.style : null })),
      meta,
    };
  }
}

// ---------- byte stream ----------

class Writer {
  buf = new Uint8Array(1024);
  len = 0;
  byte(b: number) {
    if (this.len === this.buf.length) { const nb = new Uint8Array(this.buf.length * 2); nb.set(this.buf); this.buf = nb; }
    this.buf[this.len++] = b;
  }
  /** unsigned LEB128 */
  varint(v: number) {
    while (v >= 0x80) { this.byte((v & 0x7f) | 0x80); v >>>= 7; }
    this.byte(v);
  }
  bytes() { return this.buf.slice(0, this.len); }
}

class Reader {
  pos = 0;
  private buf: Uint8Array;
  constructor(buf: Uint8Array) {
    this.buf = buf;
  }
  byte(): number {
    if (this.pos >= this.buf.length) throw new Error('frames data ends early');
    return this.buf[this.pos++];
  }
  varint(): number {
    let v = 0, shift = 0, b: number;
    do {
      b = this.byte();
      v += (b & 0x7f) * 2 ** shift;
      shift += 7;
      if (shift > 35) throw new Error('bad varint in frames data');
    } while (b & 0x80);
    return v;
  }
  get done() { return this.pos >= this.buf.length; }
}

const KEY = 0, DELTA = 1;

/** RLE over cells [from, to): (run, glyph[, style]) */
function writeRuns(w: Writer, g: Uint16Array, s: Uint16Array | null, from: number, to: number) {
  let i = from;
  while (i < to) {
    let j = i + 1;
    while (j < to && g[j] === g[i] && (!s || s[j] === s[i])) j++;
    w.varint(j - i);
    w.varint(g[i]);
    if (s) w.varint(s[i]);
    i = j;
  }
}

function readRuns(r: Reader, g: Uint16Array, s: Uint16Array | null, from: number, count: number) {
  let i = from;
  const end = from + count;
  if (end > g.length) throw new Error('frames data runs past the grid');
  while (i < end) {
    const run = r.varint(), gv = r.varint(), sv = s ? r.varint() : 0;
    if (run === 0 || i + run > end) throw new Error('bad run in frames data');
    g.fill(gv, i, i + run);
    if (s) s.fill(sv, i, i + run);
    i += run;
  }
}

function keyFrame(w: Writer, g: Uint16Array, s: Uint16Array | null) {
  w.byte(KEY);
  writeRuns(w, g, s, 0, g.length);
}

/** gaps of unchanged cells shorter than this are resent inside a span; a new span costs more */
const MIN_GAP = 3;

/** span count, then per span: (skip, count, runs...) */
function deltaFrame(w: Writer, g: Uint16Array, s: Uint16Array | null, pg: Uint16Array, ps: Uint16Array | null) {
  const n = g.length, same = (i: number) => g[i] === pg[i] && (!s || s[i] === ps![i]);
  const spans: [number, number][] = [];
  let i = 0;
  while (i < n) {
    while (i < n && same(i)) i++;
    if (i >= n) break;
    const start = i;
    let end = i + 1, j = i + 1;
    while (j < n) {
      if (!same(j)) { end = ++j; continue; }
      let k = j;
      while (k < n && same(k)) k++;
      if (k >= n || k - j >= MIN_GAP) break;
      j = k;
    }
    spans.push([start, end]);
    i = end;
  }
  w.byte(DELTA);
  w.varint(spans.length);
  let cursor = 0;
  for (const [a, b] of spans) {
    w.varint(a - cursor);
    w.varint(b - a);
    writeRuns(w, g, s, a, b);
    cursor = b;
  }
}

/** The encoded stream for a recording. Each frame is stored as a delta or a key frame, whichever is smaller. */
export function encodeStream(rec: Recording): Uint8Array {
  const out = new Writer();
  let prev: Recording['frames'][number] | null = null;
  for (const fr of rec.frames) {
    const k = new Writer();
    keyFrame(k, fr.glyph, fr.style);
    let best = k;
    if (prev) {
      const d = new Writer();
      deltaFrame(d, fr.glyph, fr.style, prev.glyph, prev.style);
      if (d.len < k.len) best = d;
    }
    for (let i = 0; i < best.len; i++) out.byte(best.buf[i]);
    prev = fr;
  }
  return out.bytes();
}

export function decodeStream(data: Uint8Array, width: number, height: number, frameCount: number, styled: boolean): Recording['frames'] {
  const n = width * height, r = new Reader(data), frames: Recording['frames'] = [];
  for (let f = 0; f < frameCount; f++) {
    const type = r.byte(), prev = frames[f - 1];
    const g = new Uint16Array(n), s = styled ? new Uint16Array(n) : null;
    if (type === KEY) {
      readRuns(r, g, s, 0, n);
    } else if (type === DELTA) {
      if (!prev) throw new Error('first frame cannot be a delta');
      g.set(prev.glyph);
      if (s) s.set(prev.style!);
      const spans = r.varint();
      let i = 0;
      for (let k = 0; k < spans; k++) {
        const skip = r.varint(), count = r.varint();
        if (count === 0) throw new Error('empty span in frames data');
        readRuns(r, g, s, i + skip, count);
        i += skip + count;
      }
    } else {
      throw new Error(`unknown frame type ${type}`);
    }
    frames.push({ glyph: g, style: s });
  }
  if (!r.done) throw new Error('extra bytes after the last frame');
  return frames;
}

// ---------- containers ----------

export function toFramesFile(rec: Recording): FramesFile {
  const file: FramesFile = {
    textel: FORMAT_VERSION,
    encoding: ENCODING,
    width: rec.width,
    height: rec.height,
    aspect: rec.aspect,
    fps: rec.fps,
    frameCount: rec.frames.length,
    glyphs: rec.glyphs,
    // header fields first, so the file reads well when opened; the long data string goes last
    ...(rec.styles ? { styles: rec.styles } : {}),
    ...(rec.bg ? { bg: rec.bg } : {}),
    ...(Object.keys(rec.meta).length ? { meta: rec.meta } : {}),
    data: toBase64(encodeStream(rec)),
  };
  return file;
}

export function fromFramesFile(file: FramesFile): Recording {
  if (!file || typeof file !== 'object') throw new Error('not a textel frames file');
  if (file.textel !== FORMAT_VERSION) throw new Error(`frames format ${file.textel} is not supported (this version reads ${FORMAT_VERSION})`);
  if (file.encoding !== ENCODING) throw new Error(`unknown frames encoding "${file.encoding}"`);
  const { width, height, frameCount } = file;
  if (!(width > 0 && height > 0 && frameCount > 0)) throw new Error('bad frames header');
  const frames = decodeStream(fromBase64(file.data), width, height, frameCount, !!file.styles);
  const nG = file.glyphs.length, nS = file.styles?.length ?? 1;
  for (const fr of frames) {
    for (let i = 0; i < fr.glyph.length; i++) {
      if (fr.glyph[i] >= nG || (fr.style && fr.style[i] >= nS)) throw new Error('frames data points outside its palette');
    }
  }
  return {
    width, height, aspect: file.aspect, fps: file.fps,
    glyphs: file.glyphs, styles: file.styles ?? null, bg: file.bg ?? null, frames, meta: file.meta ?? {},
  };
}

/** JSON text of a recording; this is what `.textel.json` holds. */
export function stringifyFrames(rec: Recording): string {
  return JSON.stringify(toFramesFile(rec));
}

export function parseFrames(text: string): Recording {
  let file: FramesFile;
  try { file = JSON.parse(text); } catch { throw new Error('not a textel frames file (invalid JSON)'); }
  return fromFramesFile(file);
}

// ---------- playback helpers ----------

/** one frame as plain text */
export function recordingText(rec: Recording, index: number): string {
  const { width: W, height: H, glyphs } = rec, g = rec.frames[index].glyph, rows: string[] = [];
  for (let r = 0; r < H; r++) {
    let s = '';
    for (let c = 0; c < W; c++) s += glyphs[g[r * W + c]];
    rows.push(s);
  }
  return rows.join('\n');
}

const rgbOf = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** one frame as ANSI lines */
export function recordingANSI(rec: Recording, index: number, depth: ColorDepth = 'truecolor'): string[] {
  const { width: W, height: H, glyphs } = rec, fr = rec.frames[index];
  const codes = (rec.styles ?? ['']).map((st) => (st === '' ? '' : st === '~' ? FAINT : fg(rgbOf(st), depth)));
  const background = bg(rec.bg ? rgbOf(rec.bg) : null, depth);
  const ch = (i: number) => glyphs[fr.glyph[i]];
  const code = fr.style ? (i: number) => codes[fr.style![i]] : () => '';
  const lines: string[] = [];
  for (let r = 0; r < H; r++) lines.push(line(ch, code, r * W, W, background));
  return lines;
}

// ---------- base64 without Buffer, so the same code runs in browsers ----------

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
