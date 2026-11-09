// A small animated GIF encoder: one global palette, LZW, and only the changed part of each frame.

export interface GIFFrames {
  width: number;
  height: number;
  /** up to 255 colors as 0xRRGGBB; one more index is kept for "unchanged" pixels */
  palette: number[];
  /** palette indices, width × height per frame */
  frames: Uint8Array[];
  /** how long each frame shows, in hundredths of a second */
  delay: number;
}

/** The frames as a GIF that loops forever. */
export function encodeGIF({ width, height, palette, frames, delay }: GIFFrames): Uint8Array<ArrayBuffer> {
  if (palette.length > 255) throw new Error('a GIF palette holds at most 255 colors here');
  const clear = palette.length; // the extra index: transparent, so the frame below shows through
  let bits = 1;
  while (1 << bits < palette.length + 1) bits++;
  const out = new Bytes();

  out.text('GIF89a');
  out.u16(width); out.u16(height);
  out.u8(0x80 | 0x70 | (bits - 1)); out.u8(0); out.u8(0);
  for (let i = 0; i < 1 << bits; i++) {
    const c = palette[i] ?? 0;
    out.u8((c >> 16) & 255); out.u8((c >> 8) & 255); out.u8(c & 255);
  }
  // loop forever
  out.u8(0x21); out.u8(0xff); out.u8(11); out.text('NETSCAPE2.0'); out.u8(3); out.u8(1); out.u16(0); out.u8(0);

  let prev: Uint8Array | null = null;
  for (const px of frames) {
    // the box that changed since the last frame; the rest stays as it was
    let x0 = 0, y0 = 0, x1 = width, y1 = height;
    if (prev) {
      [x0, y0, x1, y1] = changedBox(prev, px, width, height);
      if (x1 <= x0) [x0, y0, x1, y1] = [0, 0, 1, 1]; // nothing changed: one transparent pixel
    }
    const w = x1 - x0, h = y1 - y0, sub = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y + y0) * width + x + x0;
        sub[y * w + x] = prev && prev[i] === px[i] ? clear : px[i];
      }
    }
    // graphic control: keep the frame (disposal 1), with the transparent index
    out.u8(0x21); out.u8(0xf9); out.u8(4); out.u8(0x04 | (prev ? 1 : 0)); out.u16(delay); out.u8(clear); out.u8(0);
    out.u8(0x2c); out.u16(x0); out.u16(y0); out.u16(w); out.u16(h); out.u8(0);
    const min = Math.max(2, bits);
    out.u8(min);
    const data = lzw(sub, min);
    for (let i = 0; i < data.length; i += 255) {
      const n = Math.min(255, data.length - i);
      out.u8(n);
      out.bytes(data.subarray(i, i + n));
    }
    out.u8(0);
    prev = px;
  }
  out.u8(0x3b);
  return out.done();
}

function changedBox(a: Uint8Array, b: Uint8Array, w: number, h: number): [number, number, number, number] {
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (a[row + x] === b[row + x]) continue;
      if (x < x0) x0 = x;
      if (x >= x1) x1 = x + 1;
      if (y < y0) y0 = y;
      y1 = y + 1;
    }
  }
  return [x0, y0, x1, y1];
}

/** GIF flavored LZW: variable code size up to 12 bits, clear codes when the table is full */
export function lzw(px: Uint8Array, min: number): Uint8Array<ArrayBuffer> {
  const out = new Bytes();
  const clearCode = 1 << min, eoi = clearCode + 1;
  let size = min + 1, next = eoi + 1, cur = 0, nbits = 0;
  let table = new Map<number, number>();
  const emit = (code: number) => {
    cur |= code << nbits;
    nbits += size;
    while (nbits >= 8) { out.u8(cur & 255); cur >>>= 8; nbits -= 8; }
  };
  emit(clearCode);
  let prefix = px[0];
  for (let i = 1; i < px.length; i++) {
    const k = px[i], key = (prefix << 8) | k, hit = table.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (next === 4096) {
      emit(clearCode);
      table = new Map();
      next = eoi + 1;
      size = min + 1;
    } else {
      if (next >= 1 << size) size++;
      table.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (nbits > 0) out.u8(cur & 255);
  return out.done();
}

/** a growable byte buffer */
class Bytes {
  #buf: Uint8Array<ArrayBuffer> = new Uint8Array(1 << 16);
  #len = 0;
  #room(n: number) {
    if (this.#len + n <= this.#buf.length) return;
    const b = new Uint8Array(Math.max(this.#buf.length * 2, this.#len + n));
    b.set(this.#buf.subarray(0, this.#len));
    this.#buf = b;
  }
  u8(v: number) { this.#room(1); this.#buf[this.#len++] = v; }
  u16(v: number) { this.u8(v & 255); this.u8((v >> 8) & 255); }
  text(s: string) { for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i)); }
  bytes(b: Uint8Array) { this.#room(b.length); this.#buf.set(b, this.#len); this.#len += b.length; }
  done() { return this.#buf.slice(0, this.#len); }
}
