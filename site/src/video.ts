// MP4 in the browser: the canvas frames go through WebCodecs' H.264 encoder into muxMP4.
import { muxMP4 } from './mp4.ts';
import type { Raster } from './raster.ts';

export const canEncodeVideo = () => typeof VideoEncoder === 'function' && typeof VideoFrame === 'function';

// High, Main and Baseline profiles at level 5.1, so large frames fit
const CODECS = ['avc1.640033', 'avc1.4d0033', 'avc1.420033'];

export async function encodeMP4(raster: Raster, frames: number, fps: number, progress: (done: number) => Promise<void>): Promise<Uint8Array<ArrayBuffer>> {
  const { width, height } = raster;
  let config: VideoEncoderConfig | null = null;
  for (const codec of CODECS) {
    const c: VideoEncoderConfig = { codec, width, height, framerate: fps, bitrate: 2_500_000, avc: { format: 'avc' } };
    if ((await VideoEncoder.isConfigSupported(c)).supported) { config = c; break; }
  }
  if (!config) throw new Error('this browser cannot encode H.264 video');

  const samples: { data: Uint8Array; key: boolean }[] = [];
  let avcC: Uint8Array | null = null, failure: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      samples.push({ data, key: chunk.type === 'key' });
      const d = meta?.decoderConfig?.description;
      if (d && !avcC) avcC = ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength).slice() : new Uint8Array(d as ArrayBuffer).slice();
    },
    error: (e) => { failure = e as Error; },
  });
  encoder.configure(config);
  const step = 1e6 / fps;
  for (let i = 0; i < frames; i++) {
    raster.draw(i);
    const frame = new VideoFrame(raster.canvas, { timestamp: Math.round(i * step), duration: Math.round(step) });
    // a key frame every two seconds, so players can seek
    encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    if (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r));
    await progress(i + 1);
    if (failure) throw failure;
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  if (!avcC) throw new Error('the encoder gave no stream description');
  return muxMP4({ width, height, fps, avcC, samples });
}
