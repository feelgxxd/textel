// ANSI escape codes for colors, shared by every terminal output.
import type { RGB } from './style.ts';

export type ColorDepth = 'truecolor' | '256' | 'none';

export const RESET = '\x1b[0m';
export const FAINT = '\x1b[2m';

/** nearest xterm-256 color: grays get the 24-step ramp, everything else the 6x6x6 cube */
export function rgbTo256([r, g, b]: RGB): number {
  if (Math.abs(r - g) < 10 && Math.abs(g - b) < 10) {
    const v = (r + g + b) / 3;
    if (v < 8) return 16;
    if (v > 238) return 231;
    return 232 + Math.round(((v - 8) / 230) * 23);
  }
  const q = (x: number) => Math.round((x / 255) * 5);
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}

export function fg(c: RGB, depth: ColorDepth): string {
  if (depth === 'none') return '';
  return depth === 'truecolor' ? `\x1b[38;2;${c[0]};${c[1]};${c[2]}m` : `\x1b[38;5;${rgbTo256(c)}m`;
}

export function bg(c: RGB | null, depth: ColorDepth): string {
  if (!c || depth === 'none') return '';
  return depth === 'truecolor' ? `\x1b[48;2;${c[0]};${c[1]};${c[2]}m` : `\x1b[48;5;${rgbTo256(c)}m`;
}

/**
 * Builds one line from cells, writing a code only when it changes.
 * `code(i)` gives the code for cell i ('' for the default color); spaces keep the current code.
 */
export function line(chars: (i: number) => string, code: (i: number) => string, from: number, count: number, background = ''): string {
  let s = background, cur = '';
  for (let i = from; i < from + count; i++) {
    const ch = chars(i);
    if (ch !== ' ') {
      const c = code(i);
      if (c !== cur) { s += cur ? RESET + background + c : c; cur = c; }
    }
    s += ch;
  }
  if (cur || background) s += RESET;
  return s;
}
