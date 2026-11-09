// The frames format: types, the byte stream and the JSON container. No dependencies, so the web
// player can use it without pulling in the renderer. See docs/format.md for the layout.

export const FORMAT_VERSION = 1;
export const ENCODING = 'rle-delta-1';

/**
 * Cell styles, by index. `""` is the default color, `"~"` the default color dimmed,
 * `"#rrggbb"` a color. Index 0 is always `""`.
 */
export type CellStyle = string;

/** per-cell palette indices; Uint8Array when the palette fits in a byte */
export type CellArray = Uint8Array | Uint16Array;

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
  frames: { glyph: CellArray; style: CellArray | null }[];
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
function writeRuns(w: Writer, g: CellArray, s: CellArray | null, from: number, to: number) {
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

function readRuns(r: Reader, g: CellArray, s: CellArray | null, from: number, count: number) {
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

function keyFrame(w: Writer, g: CellArray, s: CellArray | null) {
  w.byte(KEY);
  writeRuns(w, g, s, 0, g.length);
}

/** gaps of unchanged cells shorter than this are resent inside a span; a new span costs more */
const MIN_GAP = 3;

/** span count, then per span: (skip, count, runs...) */
function deltaFrame(w: Writer, g: CellArray, s: CellArray | null, pg: CellArray, ps: CellArray | null) {
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

/**
 * Decodes the stream. Palette sizes, when given, let the frames use one byte per cell instead of two.
 */
export function decodeStream(
  data: Uint8Array, width: number, height: number, frameCount: number, styled: boolean, glyphCount = 0x10000, styleCount = 0x10000,
): Recording['frames'] {
  const G = glyphCount <= 256 ? Uint8Array : Uint16Array, S = styleCount <= 256 ? Uint8Array : Uint16Array;
  const n = width * height, r = new Reader(data), frames: Recording['frames'] = [];
  for (let f = 0; f < frameCount; f++) {
    const type = r.byte(), prev = frames[f - 1];
    const g = new G(n), s = styled ? new S(n) : null;
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
  if (!Array.isArray(file.glyphs) || !file.glyphs.length) throw new Error('bad frames header');
  const nG = file.glyphs.length, nS = file.styles?.length ?? 1;
  const frames = decodeStream(fromBase64(file.data), width, height, frameCount, !!file.styles, nG, nS);
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

// ---------- base64 without Buffer, so the same code runs in browsers ----------

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
