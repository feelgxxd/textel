// Decoders for meshopt compressed glTF buffer views (EXT_meshopt_compression and
// KHR_meshopt_compression): the vertex codec (versions 0 and 1), the index codec and index sequences,
// and the octahedral, exponential and color filters.

export interface MeshoptView {
  byteStride: number;
  count: number;
  mode: string;
  filter?: string;
}

/** `count` elements of `byteStride` bytes, decoded from `src` */
export function decodeMeshopt(src: Uint8Array, v: MeshoptView): Uint8Array {
  const { byteStride: size, count } = v, out = new Uint8Array(count * size);
  if (v.mode === 'ATTRIBUTES') {
    vertices(out, count, size, src);
    filter(out, count, size, v.filter ?? 'NONE');
  } else if (v.mode === 'TRIANGLES') triangles(out, count, size, src);
  else if (v.mode === 'INDICES') sequence(out, count, size, src);
  else throw new Error(`meshopt: unknown mode ${v.mode}`);
  return out;
}

const bad = (what: string): never => { throw new Error(`meshopt: ${what}`); };
const unzig = (v: number) => (v & 1 ? ~(v >>> 1) : v >>> 1);

function vertices(out: Uint8Array, count: number, size: number, src: Uint8Array) {
  const version = src[0] - 0xa0;
  if (version !== 0 && version !== 1) bad('unknown vertex codec version');
  if (size % 4 || size > 256) bad('vertex size must be a multiple of 4 up to 256');
  const tail = version ? size + size / 4 : size, end = src.length - tail;
  if (end < 1) bad('buffer too short');
  // deltas are relative to the previous element; the first one's is stored at the end
  const last = src.slice(end, end + size), channels = src.subarray(end + size, end + tail);
  const block = Math.min((0x2000 / size) & ~15, 256), deltas = new Uint8Array(block * size + 16);
  // header modes: bits per delta for the 2-bit code of each group of 16
  const MODES = [[0, 2, 4, 8], [0, 1, 2, 4], [1, 2, 4, 8]];
  let p = 1;
  for (let base = 0; base < count; base += block) {
    const n = Math.min(count - base, block), groups = (n + 15) >> 4, control = p;
    if (version) p += size / 4;
    deltas.fill(0);
    for (let k = 0; k < size; k++) {
      const ctl = version ? (src[control + (k >> 2)] >> ((k & 3) * 2)) & 3 : 0, d0 = k * block;
      if (ctl === 2) continue;
      if (ctl === 3) { deltas.set(src.subarray(p, p + n), d0); p += n; continue; }
      const header = p;
      p += (groups + 3) >> 2;
      for (let g = 0; g < groups; g++) {
        const bits = MODES[version ? ctl + 1 : 0][(src[header + (g >> 2)] >> ((g & 3) * 2)) & 3], d = d0 + g * 16;
        if (bits === 8) { deltas.set(src.subarray(p, p + 16), d); p += 16; continue; }
        if (!bits) continue;
        // packed values, with all ones meaning "the full byte follows"
        const packed = p, max = (1 << bits) - 1, per = 8 / bits;
        p += 2 * bits;
        for (let m = 0; m < 16; m++) {
          const byte = src[packed + Math.floor(m / per)];
          // 1-bit values are stored low bit first, wider ones high bits first
          const shift = bits === 1 ? m & 7 : 8 - bits * ((m % per) + 1);
          const x = (byte >> shift) & max;
          deltas[d + m] = x === max ? src[p++] : x;
        }
      }
    }
    for (let e = 0; e < n; e++) {
      const o = (base + e) * size;
      for (let g = 0; g < size; g += 4) {
        const ch = version ? channels[g >> 2] : 0, mode = ch & 3;
        if (mode === 0) {
          for (let k = g; k < g + 4; k++) out[o + k] = last[k] = (last[k] + unzig(deltas[k * block + e])) & 255;
        } else if (mode === 1) {
          for (let k = g; k < g + 4; k += 2) {
            const x = (last[k] | (last[k + 1] << 8)) + unzig(deltas[k * block + e] | (deltas[(k + 1) * block + e] << 8));
            out[o + k] = last[k] = x & 255;
            out[o + k + 1] = last[k + 1] = (x >> 8) & 255;
          }
        } else if (mode === 2) {
          let d = 0, x = 0;
          for (let j = 3; j >= 0; j--) { d = (d << 8) | deltas[(g + j) * block + e]; x = (x << 8) | last[g + j]; }
          const r = ch >> 4;
          x ^= r ? (d >>> r) | (d << (32 - r)) : d;
          for (let j = 0; j < 4; j++) out[o + g + j] = last[g + j] = (x >>> (j * 8)) & 255;
        } else bad('unknown channel mode');
      }
    }
  }
  if (p !== src.length - Math.max(tail, version ? 24 : 32)) bad('vertex data has the wrong length');
}

function filter(out: Uint8Array, count: number, size: number, f: string) {
  if (f === 'NONE') return;
  if (f === 'OCTAHEDRAL' || f === 'COLOR') {
    if (size !== 4 && size !== 8) bad(`${f} filter needs 4 or 8 bytes`);
    const wide = size === 8, s = wide ? new Int16Array(out.buffer) : new Int8Array(out.buffer);
    const u = wide ? new Uint16Array(out.buffer) : out;
    for (let i = 0; i < count * 4; i += 4) {
      if (f === 'OCTAHEDRAL') {
        // x, y on the octahedron with z = 1 - |x| - |y|, folded for the lower half; w is kept
        const max = wide ? 32767 : 127, one = s[i + 2];
        let x = s[i] / one, y = s[i + 1] / one;
        const z = 1 - Math.abs(x) - Math.abs(y), t = Math.max(-z, 0);
        x -= x >= 0 ? t : -t;
        y -= y >= 0 ? t : -t;
        const h = max / Math.hypot(x, y, z);
        s[i] = Math.round(x * h); s[i + 1] = Math.round(y * h); s[i + 2] = Math.round(z * h);
      } else {
        // YCoCg with alpha, which also says how many bits the color uses
        const Y = u[i], co = s[i + 1], cg = s[i + 2], a0 = u[i + 3];
        const as = (1 << (32 - Math.clz32(a0))) - 1, k = ((1 << (size * 2)) - 1) / as;
        let a = a0 & (as >> 1);
        a = (a << 1) | (a & 1);
        u[i] = Math.round((Y + co - cg) * k); u[i + 1] = Math.round((Y + cg) * k); u[i + 2] = Math.round((Y - co - cg) * k); u[i + 3] = Math.round(a * k);
      }
    }
  } else if (f === 'EXPONENTIAL') {
    if (size % 4) bad('EXPONENTIAL filter needs a multiple of 4 bytes');
    const src = new Int32Array(out.buffer), dst = new Float32Array(out.buffer);
    for (let i = 0; i < (count * size) / 4; i++) dst[i] = 2 ** (src[i] >> 24) * ((src[i] << 8) >> 8);
  } else bad(`the ${f} filter is not supported`);
}

/** reads a LEB128 number at `at[0]`, moving it on */
function vbyte(src: Uint8Array, at: number[]): number {
  let n = 0;
  for (let s = 0; s < 35; s += 7) {
    const b = src[at[0]++];
    n |= (b & 127) << s;
    if (b < 128) break;
  }
  return n >>> 0;
}

function triangles(out: Uint8Array, count: number, size: number, src: Uint8Array) {
  const version = src[0] - 0xe0;
  if (version !== 0 && version !== 1) bad('unknown index codec version');
  if (count % 3 || src.length < 1 + count / 3 + 16) bad('bad triangle data');
  const dst = size === 2 ? new Uint16Array(out.buffer) : size === 4 ? new Uint32Array(out.buffer) : bad('index size must be 2 or 4');
  // most recent first: 16 edges (pairs) and 16 vertices
  const edges = new Uint32Array(32), verts = new Uint32Array(16);
  const pushV = (v: number) => { verts.copyWithin(1, 0, 15); verts[0] = v; };
  const pushE = (a: number, b: number) => { edges.copyWithin(2, 0, 30); edges[0] = a; edges[1] = b; };
  const aux = src.length - 16, at = [1 + count / 3];
  let next = 0, last = 0, code = 1;
  const free = () => (last = (last + unzig(vbyte(src, at))) >>> 0);
  for (let i = 0; i < count; i += 3) {
    const c0 = src[code++], hi = c0 >> 4, lo = c0 & 15;
    let a: number, b: number, c: number;
    if (hi < 15) {
      // a known edge plus one vertex: new, from the fifo, a neighbor of the last free index, or free
      a = edges[hi * 2]; b = edges[hi * 2 + 1];
      if (lo === 0) pushV(c = next++);
      else if (lo < 13 || (version === 0 && lo < 15)) c = verts[lo];
      else if (lo === 13) pushV(c = --last);
      else if (lo === 14) pushV(c = ++last);
      else pushV(c = free());
      pushE(c, b); pushE(a, c);
    } else {
      // three vertices, coded through the table at the end or a byte of their own
      const own = lo >= 14, e = own ? src[at[0]++] : src[aux + lo], z = e >> 4, w = e & 15;
      if (own && e === 0) next = 0;
      a = own && lo === 15 ? free() : next++;
      b = z === 0 ? next++ : own && z === 15 ? free() : verts[z - 1];
      c = w === 0 ? next++ : own && w === 15 ? free() : verts[w - 1];
      pushV(a);
      if (z === 0 || (own && z === 15)) pushV(b);
      if (w === 0 || (own && w === 15)) pushV(c);
      pushE(b, a); pushE(c, b); pushE(a, c);
    }
    dst[i] = a; dst[i + 1] = b; dst[i + 2] = c;
  }
}

function sequence(out: Uint8Array, count: number, size: number, src: Uint8Array) {
  if (src[0] !== 0xd1) bad('unknown index sequence version');
  const dst = size === 2 ? new Uint16Array(out.buffer) : size === 4 ? new Uint32Array(out.buffer) : bad('index size must be 2 or 4');
  const last = [0, 0], at = [1];
  for (let i = 0; i < count; i++) {
    const v = vbyte(src, at), k = v & 1;
    dst[i] = last[k] = (last[k] + unzig(v >>> 1)) >>> 0;
  }
}
