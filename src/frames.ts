// Recording: renders a loop into a frames recording, and plays one back as ANSI.
// The format itself lives in format.ts.
import { bg, FAINT, fg, line, type ColorDepth } from './ansi.ts';
import type { Recording } from './format.ts';
import { cellColor } from './output.ts';
import type { Frame, Renderer } from './render.ts';
import type { RGB } from './style.ts';

export * from './format.ts';
export { recordingSVG, type SVGOptions } from './svg.ts';

/** Options of recordLoop. */
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
  colorRound?: number;
  meta?: Record<string, unknown>;
  /** called after each frame, for progress */
  onFrame?: (done: number, total: number) => void;
}

const hex = (c: RGB) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** Renders a seamless turntable loop: the last frame leads straight back into the first. */
export function recordLoop(renderer: Renderer, opts: RecordOptions = {}): Recording {
  const n = Math.max(1, Math.round(opts.frames ?? 120)), turns = opts.turns ?? 1, yaw0 = opts.yaw ?? 0;
  const rec = new RecordingBuilder(opts.colorRound ?? 8);
  const yaw = (i: number) => yaw0 + (i / n) * turns * Math.PI * 2;
  // steady glyphs remember the frame before: spin once first, so the first frame follows the last
  if (renderer.style.steady > 0) for (let i = 0; i < n; i++) renderer.render({ yaw: yaw(i) });
  for (let i = 0; i < n; i++) {
    rec.add(renderer.render({ yaw: yaw(i) }));
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

  constructor(colorRound = 8) {
    this.step = Math.max(1, colorRound);
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
