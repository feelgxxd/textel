import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildExample, EXAMPLES } from '../src/examples.ts';
import {
  decodeStream, encodeStream, fromFramesFile, parseFrames, recordingANSI, recordingText, recordLoop, stringifyFrames, toFramesFile,
  type Recording,
} from '../src/frames.ts';
import { toText } from '../src/output.ts';
import { createRenderer } from '../src/render.ts';
import { mergeStyles, type StyleInput } from '../src/style.ts';

const same = (a: Recording, b: Recording) => {
  assert.equal(b.frames.length, a.frames.length);
  // values, not array types: decoding uses one byte per cell when the palette allows it
  const vals = (x: ArrayLike<number> | null) => (x ? Array.from(x) : null);
  for (let f = 0; f < a.frames.length; f++) {
    assert.deepEqual(vals(b.frames[f].glyph), vals(a.frames[f].glyph), `glyphs of frame ${f}`);
    assert.deepEqual(vals(b.frames[f].style), vals(a.frames[f].style), `styles of frame ${f}`);
  }
  const small = b.glyphs.length <= 256;
  assert.equal(b.frames[0].glyph instanceof Uint8Array, small, 'glyph array width follows the palette size');
};

const meshes = new Map(EXAMPLES.map((e) => [e.name, buildExample(e)]));

for (const e of EXAMPLES) {
  const variants: [string, StyleInput][] = [['plain', {}], ['gradient', { color: ['#301000', '#ffb000'] }]];
  for (const [variant, extra] of variants) {
    test(`frames round trip: ${e.name} ${variant}`, () => {
      const r = createRenderer(meshes.get(e.name)!, mergeStyles(e.style, { width: 64, height: 26, ...extra }));
      const rec = recordLoop(r, { frames: 24, meta: { title: e.title } });
      const back = parseFrames(stringifyFrames(rec));
      same(rec, back);
      assert.deepEqual(back.glyphs, rec.glyphs);
      assert.deepEqual(back.styles, rec.styles);
      assert.equal(back.meta.title, e.title);
      // the text of a played frame is exactly what the renderer drew
      assert.equal(recordingText(back, 5), toText(r.render({ yaw: (5 / 24) * Math.PI * 2 })));
    });
  }
}

/** deterministic pseudo random numbers */
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test('frames round trip: random recordings with large palettes', () => {
  const rand = rng(7);
  for (let trial = 0; trial < 20; trial++) {
    const W = 1 + Math.floor(rand() * 90), H = 1 + Math.floor(rand() * 40), n = W * H;
    const nG = 2 + Math.floor(rand() * 400), nS = rand() < 0.3 ? 0 : 2 + Math.floor(rand() * 300);
    const frames: Recording['frames'] = [];
    let g = new Uint16Array(n), s = nS ? new Uint16Array(n) : null;
    for (let f = 0; f < 1 + Math.floor(rand() * 12); f++) {
      g = g.slice(); s = s ? s.slice() : null;
      // anything from a few changed cells to a whole new frame
      const changes = rand() < 0.2 ? n : Math.floor(rand() * n * 0.3);
      for (let k = 0; k < changes; k++) {
        const i = Math.floor(rand() * n);
        g[i] = Math.floor(rand() * nG);
        if (s) s[i] = Math.floor(rand() * nS);
      }
      frames.push({ glyph: g, style: s });
    }
    const rec: Recording = {
      width: W, height: H, aspect: 2, fps: 30,
      glyphs: Array.from({ length: nG }, (_, i) => String.fromCodePoint(0x21 + i)),
      styles: nS ? Array.from({ length: nS }, (_, i) => (i === 0 ? '' : '#' + i.toString(16).padStart(6, '0'))) : null,
      bg: null, frames, meta: {},
    };
    same(rec, fromFramesFile(toFramesFile(rec)));
  }
});

test('frames: unchanged frames cost almost nothing', () => {
  const r = createRenderer(meshes.get('dice')!, { width: 80, height: 30 });
  const f = r.render();
  const g = f.chars.map((c) => (c === ' ' ? 0 : 1));
  const one = new Uint16Array(g);
  const rec: Recording = { width: 80, height: 30, aspect: 2, fps: 30, glyphs: [' ', '#'], styles: null, bg: null, frames: [{ glyph: one, style: null }], meta: {} };
  const still = { ...rec, frames: Array.from({ length: 50 }, () => ({ glyph: one, style: null })) };
  // each repeated frame is a type byte and a zero span count
  assert.equal(encodeStream(still).length, encodeStream(rec).length + 49 * 2);
});

test('frames: bad input is rejected with a clear message', () => {
  const r = createRenderer(meshes.get('donut')!, { width: 30, height: 12 });
  const file = toFramesFile(recordLoop(r, { frames: 4 }));
  assert.throws(() => parseFrames('nope'), /invalid JSON/);
  assert.throws(() => fromFramesFile({ ...file, textel: 99 }), /format 99 is not supported/);
  assert.throws(() => fromFramesFile({ ...file, encoding: 'zip' }), /unknown frames encoding/);
  assert.throws(() => fromFramesFile({ ...file, frameCount: 5 }), /ends early/);
  assert.throws(() => fromFramesFile({ ...file, frameCount: 3 }), /extra bytes/);
  assert.throws(() => fromFramesFile({ ...file, glyphs: [' '] }), /outside its palette/);
  const bytes = encodeStream(fromFramesFile(file));
  assert.throws(() => decodeStream(bytes.subarray(0, bytes.length - 3), 30, 12, 4, false), /ends early|bad run/);
});

test('frames: ANSI playback carries colors and dim', () => {
  const ex = EXAMPLES.find((e) => e.name === 'rocket')!;
  const colored = recordLoop(createRenderer(meshes.get('rocket')!, mergeStyles(ex.style, { width: 40, height: 16, color: '#ff8800' })), { frames: 2 });
  assert.match(recordingANSI(colored, 0).join(''), /\x1b\[38;2;\d+;\d+;\d+m/);
  assert.match(recordingANSI(colored, 0, '256').join(''), /\x1b\[38;5;\d+m/);
  const plain = recordLoop(createRenderer(meshes.get('rocket')!, mergeStyles(ex.style, { width: 40, height: 16 })), { frames: 2 });
  assert.deepEqual(plain.styles, ['', '~'], 'dim materials without color are stored as "~"');
  assert.match(recordingANSI(plain, 0).join(''), /\x1b\[2m/);
});
