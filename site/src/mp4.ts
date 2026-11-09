// A minimal MP4 writer for one H.264 video track, with the index up front so it starts playing at once.

export interface MP4Video {
  width: number;
  height: number;
  fps: number;
  /** the avcC record (WebCodecs gives it as the decoder config's description) */
  avcC: Uint8Array;
  /** encoded frames in AVCC form (length-prefixed NAL units), in order, without B-frames */
  samples: { data: Uint8Array; key: boolean }[];
}

export function muxMP4({ width, height, fps, avcC, samples }: MP4Video): Uint8Array<ArrayBuffer> {
  // a timescale where every frame lasts a whole number of ticks
  const timescale = Math.round(fps * 1000), delta = 1000, duration = samples.length * delta;
  const ftyp = box('ftyp', str('isom'), u32(0x200), str('isom'), str('iso2'), str('avc1'), str('mp41'));
  const moov = (offset: number) => box('moov',
    full('mvhd', 0, 0, u32(0), u32(0), u32(timescale), u32(duration), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(2)),
    box('trak',
      full('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(duration), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(width << 16), u32(height << 16)),
      box('mdia',
        full('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(duration), u16(0x55c4), u16(0)),
        full('hdlr', 0, 0, u32(0), str('vide'), zeros(12), str('VideoHandler\0')),
        box('minf',
          full('vmhd', 0, 1, zeros(8)),
          box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))),
          box('stbl',
            full('stsd', 0, 0, u32(1), box('avc1',
              zeros(6), u16(1), zeros(16), u16(width), u16(height), u32(0x00480000), u32(0x00480000), u32(0), u16(1),
              zeros(32), u16(0x18), u16(0xffff), box('avcC', avcC))),
            full('stts', 0, 0, u32(1), u32(samples.length), u32(delta)),
            full('stss', 0, 0, u32(samples.filter((s) => s.key).length), ...samples.flatMap((s, i) => (s.key ? [u32(i + 1)] : []))),
            full('stsc', 0, 0, u32(1), u32(1), u32(samples.length), u32(1)),
            full('stsz', 0, 0, u32(0), u32(samples.length), ...samples.map((s) => u32(s.data.length))),
            full('stco', 0, 0, u32(1), u32(offset)),
          ),
        ),
      ),
    ),
  );
  // the samples follow the index, so the index has to know its own size first
  const head = ftyp.length + moov(0).length;
  const size = samples.reduce((n, s) => n + s.data.length, 8);
  return concat([ftyp, moov(head + 8), u32(size), str('mdat'), ...samples.map((s) => s.data)]);
}

const MATRIX = concat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]);

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const body = concat(parts);
  return concat([u32(body.length + 8), str(type), body]);
}
function full(type: string, version: number, flags: number, ...parts: Uint8Array[]): Uint8Array {
  return box(type, u32((version << 24) | flags), ...parts);
}
function u32(v: number) { return new Uint8Array([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]); }
function u16(v: number) { return new Uint8Array([(v >>> 8) & 255, v & 255]); }
function zeros(n: number) { return new Uint8Array(n); }
function str(s: string) { return Uint8Array.from(s, (c) => c.charCodeAt(0)); }
function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
