// The parts of <textel-player> that do not touch the DOM, so they can be tested anywhere.
import type { Recording } from '../format.ts';

/** what goes into the <pre> for one frame: plain text when the file has no styles, otherwise HTML */
export interface Markup {
  html: boolean;
  content: string;
}

const esc = (ch: string) => (ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '&' ? '&amp;' : ch);

export function frameMarkup(rec: Recording, index: number): Markup {
  const { width: W, height: H, glyphs, styles } = rec, fr = rec.frames[index];
  if (!styles || !fr.style) {
    let s = '';
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) s += glyphs[fr.glyph[r * W + c]];
      if (r < H - 1) s += '\n';
    }
    return { html: false, content: s };
  }
  // one span per run of cells with the same style; spaces never open a span
  const open = styles.map((st) => (st === '' ? '' : st === '~' ? '<span class="d">' : `<span style="color:${st}">`));
  let s = '';
  for (let r = 0; r < H; r++) {
    let cur = 0;
    for (let c = 0; c < W; c++) {
      const i = r * W + c, ch = glyphs[fr.glyph[i]];
      if (ch !== ' ') {
        const st = fr.style[i];
        if (st !== cur) {
          if (cur) s += '</span>';
          s += open[st];
          cur = st;
        }
      }
      s += esc(ch);
    }
    if (cur) s += '</span>';
    if (r < H - 1) s += '\n';
  }
  return { html: true, content: s };
}

/** the accessible name: an explicit label, the file's title, or a generic one */
export function accessibleLabel(rec: Recording | null, label: string | null): string {
  if (label) return label;
  const t = rec?.meta.title;
  return typeof t === 'string' && t ? `${t}, ASCII animation` : 'ASCII animation';
}

/** frame position after `dt` seconds; gaps longer than 0.1 s (tab switches) do not jump ahead */
export function advance(pos: number, dt: number, fps: number, frames: number): number {
  return (pos + Math.min(Math.max(dt, 0), 0.1) * fps) % frames;
}

/** dragging across the whole width moves through the whole loop once */
export function scrub(pos: number, dx: number, width: number, frames: number): number {
  if (!(width > 0)) return pos;
  return (((pos + (dx / width) * frames) % frames) + frames) % frames;
}

/**
 * How to show a grid of `cols`×`rows` cells drawn in a font whose cells measure `cellW`×`cellH`,
 * so it fills `boxW`×`boxH` (boxH 0 = width decides) with the proportions it was rendered for:
 * `stretchY` corrects the font's cell shape to the file's `aspect`, `scale` fits the result.
 */
export function fit(cols: number, rows: number, aspect: number, cellW: number, cellH: number, boxW: number, boxH: number) {
  const stretchY = cellW > 0 && cellH > 0 ? (aspect * cellW) / cellH : 1;
  const w = cols * cellW, h = rows * cellH * stretchY;
  if (!(w > 0 && h > 0)) return { scale: 1, stretchY, ratio: 1 };
  const scale = boxH > 0 ? Math.min(boxW / w, boxH / h) : boxW / w;
  return { scale, stretchY, ratio: w / h };
}
