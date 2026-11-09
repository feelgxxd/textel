// The playground's GIF encoder and MP4 writer, checked by reading their output back.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeGIF } from '../site/src/gif.ts';
import { muxMP4 } from '../site/src/mp4.ts';
import { inkPalette } from '../site/src/raster.ts';

/** a small GIF reader: the composed frames as palette indices, plus the delays and loop flag */
function readGIF(b: Uint8Array) {
  let p = 0;
  const u8 = () => b[p++], u16 = () => b[p++] | (b[p++] << 8);
  assert.equal(String.fromCharCode(...b.subarray(0, 6)), 'GIF89a');
  p = 6;
  const W = u16(), H = u16(), flags = u8();
  p += 2;
  const colors = 1 << ((flags & 7) + 1);
  const palette = Array.from({ length: colors }, () => (u8() << 16) | (u8() << 8) | u8());
  const screen = new Uint8Array(W * H), frames: Uint8Array[] = [], delays: number[] = [];
  let loops = false, transparent = -1;
  for (;;) {
    const t = u8();
    if (t === 0x3b) break;
    if (t === 0x21) {
      const label = u8();
      if (label === 0xf9) { p++; const f = u8(); delays.push(u16()); const ti = u8(); transparent = f & 1 ? ti : -1; p++; continue; }
      if (label === 0xff) loops = String.fromCharCode(...b.subarray(p + 1, p + 12)) === 'NETSCAPE2.0';
      for (let n = u8(); n; n = u8()) p += n;
      continue;
    }
    assert.equal(t, 0x2c, 'an image follows');
    const x0 = u16(), y0 = u16(), w = u16(), h = u16();
    p++;
    const min = u8(), data: number[] = [];
    for (let n = u8(); n; n = u8()) { data.push(...b.subarray(p, p + n)); p += n; }
    const px = unlzw(data, min, w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = px[y * w + x];
      if (v !== transparent) screen[(y + y0) * W + x + x0] = v;
    }
    frames.push(screen.slice());
  }
  return { W, H, palette, frames, delays, loops };
}

function unlzw(data: number[], min: number, count: number): number[] {
  const clear = 1 << min, eoi = clear + 1, out: number[] = [];
  let size = min + 1, dict: number[][] = [], prev: number[] | null = null, bit = 0;
  const reset = () => { dict = Array.from({ length: clear + 2 }, (_, i) => [i]); size = min + 1; prev = null; };
  reset();
  while (out.length < count) {
    let code = 0;
    for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
    if (code === clear) { reset(); continue; }
    if (code === eoi) break;
    const entry: number[] = code < dict.length ? dict[code] : [...prev!, prev![0]];
    out.push(...entry);
    if (prev) dict.push([...prev, entry[0]]);
    prev = entry;
    if (dict.length === 1 << size && size < 12) size++;
  }
  return out;
}

test('gif: frames read back exactly, looping, with their delay', () => {
  let seed = 3;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (const [W, H, colors, noise] of [[40, 30, 4, 0.2], [64, 40, 200, 1], [9, 5, 2, 0.5]] as const) {
    const palette = Array.from({ length: colors }, (_, i) => i * 0x010203);
    const frames: Uint8Array[] = [];
    let f = new Uint8Array(W * H).map((_, i) => i % colors);
    for (let n = 0; n < 5; n++) {
      if (n !== 3) f = f.map((v) => (rnd() < noise ? Math.floor(rnd() * colors) : v)); // frame 3 repeats frame 2
      frames.push(f.slice());
    }
    const gif = readGIF(encodeGIF({ width: W, height: H, palette, frames, delay: 5 }));
    assert.equal(gif.W, W);
    assert.equal(gif.loops, true);
    assert.deepEqual(gif.delays, [5, 5, 5, 5, 5]);
    assert.deepEqual(gif.palette.slice(0, colors), palette);
    gif.frames.forEach((fr, i) => assert.deepEqual([...fr], [...frames[i]], `${W}x${H}, frame ${i}`));
  }
});

test('gif: the ink palette covers soft glyph edges and keeps the background exact', () => {
  const pal = inkPalette([0x111214, 0xe8e8e8]);
  assert.equal(pal.palette[0], 0x111214);
  assert.ok(pal.palette.length >= 16 && pal.palette.length <= 255);
  assert.equal(pal.palette[pal.index(0x111214)], 0x111214);
  assert.equal(pal.palette[pal.index(0xe8e8e8)], 0xe8e8e8);
  const mid = pal.palette[pal.index(0x7c7d7e)];
  assert.ok(Math.abs((mid >> 16) - 0x7c) < 12, 'a half covered pixel stays half way');
  // a smooth gradient has too many inks for blends: a color cube instead
  const many = inkPalette([0, ...Array.from({ length: 100 }, (_, i) => i * 0x020101)]);
  assert.ok(many.palette.length <= 255);
});

/** the MP4 box tree as [type, start, end] paths */
function boxes(b: Uint8Array, start = 0, end = b.length, path = ''): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>(), dv = new DataView(b.buffer, b.byteOffset);
  const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf']);
  for (let p = start; p < end;) {
    const size = dv.getUint32(p), type = String.fromCharCode(...b.subarray(p + 4, p + 8)), name = path + '/' + type;
    assert.ok(size >= 8 && p + size <= end, `${name} fits`);
    out.set(name, [p, p + size]);
    if (containers.has(type)) for (const [k, v] of boxes(b, p + 8, p + size, name)) out.set(k, v);
    p += size;
  }
  return out;
}

test('mp4: boxes nest, the index comes first and points at every sample', () => {
  const samples = [7, 3, 5, 9].map((n, i) => ({ data: new Uint8Array(n).fill(i + 1), key: i % 2 === 0 }));
  const avcC = new Uint8Array([1, 0x64, 0, 0x33, 0xff, 0xe1, 0, 1, 0x67, 1, 0, 1, 0x68]);
  const mp4 = muxMP4({ width: 640, height: 480, fps: 20, avcC, samples });
  const tree = boxes(mp4), dv = new DataView(mp4.buffer);
  assert.deepEqual([...tree.keys()].filter((k) => k.split('/').length === 2), ['/ftyp', '/moov', '/mdat'], 'faststart order');
  const at = (k: string) => tree.get(k)![0];
  const stbl = '/moov/trak/mdia/minf/stbl';
  // 4 samples of 1/20 s
  assert.equal(dv.getUint32(at('/moov/mvhd') + 20), 20000, 'timescale');
  assert.equal(dv.getUint32(at('/moov/mvhd') + 24), 4000, 'duration');
  assert.deepEqual([dv.getUint32(at(stbl + '/stts') + 16), dv.getUint32(at(stbl + '/stts') + 20)], [4, 1000]);
  assert.deepEqual([12, 16].map((o) => dv.getUint32(at(stbl + '/stss') + o + 4)), [1, 3], 'key frames 1 and 3');
  const sizes = [0, 1, 2, 3].map((i) => dv.getUint32(at(stbl + '/stsz') + 20 + i * 4));
  assert.deepEqual(sizes, [7, 3, 5, 9]);
  const offset = dv.getUint32(at(stbl + '/stco') + 16);
  assert.equal(offset, at('/mdat') + 8, 'the chunk starts right after the mdat header');
  assert.deepEqual([...mp4.subarray(offset, offset + 24)], samples.flatMap((s) => [...s.data]));
  const stsd = tree.get(stbl + '/stsd')!;
  assert.notEqual(Buffer.from(mp4.subarray(...stsd)).indexOf(Buffer.from(avcC)), -1, 'the avcC record is inside');
});
