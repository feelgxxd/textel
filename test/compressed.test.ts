// Compressed glTF: meshopt is decoded by textel itself, checked here against meshoptimizer's own
// decoder; Draco goes through the draco3d package. Both packages are only dev dependencies.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import draco3d from 'draco3d';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { createDracoDecoder } from '../src/loaders/draco.ts';
import { parseGLTF } from '../src/loaders/gltf.ts';
import { decodeMeshopt } from '../src/loaders/meshopt.ts';

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;

const bytes = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/** a sphere: positions, unit normals and triangle indices */
function sphere(N: number) {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const th = (Math.PI * j) / N, ph = (2 * Math.PI * i) / N;
    const x = Math.sin(th) * Math.cos(ph), y = Math.cos(th), z = Math.sin(th) * Math.sin(ph);
    pos.push(x * 2, y * 2, z * 2); nor.push(x, y, z);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i;
    idx.push(a, a + 1, a + N + 2, a, a + N + 2, a + N + 1);
  }
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), idx: new Uint32Array(idx), count: (N + 1) * (N + 1) };
}

function same(mode: string, source: Uint8Array, count: number, size: number, filter = 'NONE', version = 0) {
  const enc = MeshoptEncoder.encodeGltfBuffer(source, count, size, mode, version);
  const want = new Uint8Array(count * size);
  MeshoptDecoder.decodeGltfBuffer(want, count, size, enc, mode, filter === 'NONE' ? undefined : filter);
  assert.deepEqual(decodeMeshopt(enc, { byteStride: size, count, mode, filter }), want, `${mode} ${filter} v${version}`);
}

test('meshopt: every codec and filter decodes like meshoptimizer does', () => {
  const s = sphere(40);
  for (const version of [0, 1]) {
    same('ATTRIBUTES', bytes(s.pos), s.count, 12, 'NONE', version);
    // bytes that do not follow a pattern, and a long run to cross several blocks
    const noise = new Uint8Array(3000 * 8).map((_, i) => (i * 2654435761) >>> 24);
    same('ATTRIBUTES', noise, 3000, 8, 'NONE', version);
    same('ATTRIBUTES', MeshoptEncoder.encodeFilterOct(new Float32Array([...s.nor].flatMap((v, i) => (i % 3 === 2 ? [v, 0] : [v]))), s.count, 4, 8), s.count, 4, 'OCTAHEDRAL', version);
    same('ATTRIBUTES', MeshoptEncoder.encodeFilterOct(new Float32Array([...s.nor].flatMap((v, i) => (i % 3 === 2 ? [v, 0] : [v]))), s.count, 8, 12), s.count, 8, 'OCTAHEDRAL', version);
    same('ATTRIBUTES', MeshoptEncoder.encodeFilterExp(s.pos, s.count, 12, 15), s.count, 12, 'EXPONENTIAL', version);
  }
  const rgba = new Float32Array(s.count * 4).map((_, i) => (i % 4 === 3 ? 1 : (Math.sin(i) + 1) / 2));
  same('ATTRIBUTES', MeshoptEncoder.encodeFilterColor(rgba, s.count, 4, 8), s.count, 4, 'COLOR', 1);
  same('TRIANGLES', bytes(s.idx), s.idx.length, 4);
  same('TRIANGLES', bytes(new Uint16Array(s.idx)), s.idx.length, 2);
  same('INDICES', bytes(s.idx), s.idx.length, 4);
});

/** a .gltf with one primitive, its buffers inlined; `views` are [bytes, extra buffer view fields] */
function gltf(views: [Uint8Array, object][], primitive: object, accessors: object[], extensions: string[]) {
  const parts: Uint8Array[] = [], bufferViews: object[] = [];
  let length = 0;
  for (const [b, fields] of views) {
    bufferViews.push({ buffer: 0, byteOffset: length, byteLength: b.length, ...fields });
    parts.push(b, new Uint8Array((4 - (b.length % 4)) % 4));
    length += b.length + ((4 - (b.length % 4)) % 4);
  }
  const all = new Uint8Array(length);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  const json = {
    asset: { version: '2.0' }, extensionsUsed: extensions, extensionsRequired: extensions,
    scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [primitive] }], accessors, bufferViews,
    // a meshopt fallback buffer has no data; nothing should read it
    buffers: [{ byteLength: length, uri: 'data:application/octet-stream;base64,' + Buffer.from(all).toString('base64') }, { byteLength: 1 << 20, extensions: { EXT_meshopt_compression: { fallback: true } } }],
  };
  return new TextEncoder().encode(JSON.stringify(json));
}

test('meshopt: a compressed glTF loads like the plain one', () => {
  const s = sphere(24), n = s.idx.length;
  // normals as octahedral int8 (KHR_mesh_quantization), positions as float
  const nor4 = new Float32Array([...s.nor].flatMap((v, i) => (i % 3 === 2 ? [v, 0] : [v])));
  const octa = MeshoptEncoder.encodeFilterOct(nor4, s.count, 4, 8);
  const ext = (mode: string, src: Uint8Array, count: number, size: number, filter?: string) => [
    MeshoptEncoder.encodeGltfBuffer(src, count, size, mode),
    { buffer: 1, byteLength: count * size, ...(mode === 'ATTRIBUTES' ? { byteStride: size } : {}), extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: 0, byteLength: 0, byteStride: size, count, mode, filter } } },
  ] as [Uint8Array, object];
  const views = [ext('ATTRIBUTES', bytes(s.pos), s.count, 12), ext('ATTRIBUTES', octa, s.count, 4, 'OCTAHEDRAL'), ext('TRIANGLES', bytes(s.idx), n, 4)];
  // the meshopt sources sit in buffer 0, one after another: fix the offsets the helper cannot know
  let off = 0;
  for (const v of views) {
    const e = (v[1] as { extensions: { EXT_meshopt_compression: { byteOffset: number; byteLength: number } } }).extensions.EXT_meshopt_compression;
    e.byteOffset = off; e.byteLength = v[0].length;
    off += v[0].length + ((4 - (v[0].length % 4)) % 4);
  }
  const accessors = [
    { bufferView: 0, componentType: 5126, count: s.count, type: 'VEC3' },
    { bufferView: 1, componentType: 5120, normalized: true, count: s.count, type: 'VEC3' },
    { bufferView: 2, componentType: 5125, count: n, type: 'SCALAR' },
  ];
  const m = parseGLTF(gltf(views, { attributes: { POSITION: 0, NORMAL: 1 }, indices: 2 }, accessors, ['EXT_meshopt_compression', 'KHR_mesh_quantization']));
  // (+0 so that -0 from the node transform equals 0)
  assert.deepEqual([...m.positions].map((x) => x + 0), [...s.pos].map((x) => x + 0));
  // the index codec may rotate a triangle's corners, keeping its winding
  const rot = (I: ArrayLike<number>) => Array.from({ length: I.length / 3 }, (_, t) => { const c = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]], k = c.indexOf(Math.min(...c)); return [c[k], c[(k + 1) % 3], c[(k + 2) % 3]].join(); });
  assert.deepEqual(rot(m.indices), rot(s.idx));
  for (let i = 0; i < s.nor.length; i++) assert.ok(Math.abs(m.normals![i] - s.nor[i]) < 0.03, 'normals within 8-bit precision');
});

test('draco: decoded through draco3d; without a decoder the error says what to do', async () => {
  const s = sphere(24), n = s.idx.length;
  const E = await draco3d.createEncoderModule({});
  const builder = new E.MeshBuilder(), mesh = new E.Mesh(), encoder = new E.Encoder();
  builder.AddFacesToMesh(mesh, n / 3, s.idx);
  const posId = builder.AddFloatAttributeToMesh(mesh, E.POSITION, s.count, 3, s.pos);
  const colors = new Float32Array(s.count * 4).map((_, i) => (i % 4 === 3 ? 1 : ((i * 37) % 256) / 255));
  const colId = builder.AddFloatAttributeToMesh(mesh, E.COLOR, s.count, 4, colors);
  encoder.SetAttributeQuantization(E.POSITION, 14);
  const out = new E.DracoInt8Array();
  const len = encoder.EncodeMeshToDracoBuffer(mesh, out);
  const data = new Uint8Array(len);
  for (let i = 0; i < len; i++) data[i] = out.GetValue(i);
  E.destroy(out); E.destroy(encoder); E.destroy(mesh); E.destroy(builder);

  // draco may reorder points, so accessors only say how many and what type
  const accessors = [
    { componentType: 5126, count: s.count, type: 'VEC3' },
    { componentType: 5126, count: s.count, type: 'VEC4' },
    { componentType: 5125, count: n, type: 'SCALAR' },
  ];
  const prim = { attributes: { POSITION: 0, COLOR_0: 1 }, indices: 2, extensions: { KHR_draco_mesh_compression: { bufferView: 0, attributes: { POSITION: posId, COLOR_0: colId } } } };
  const file = gltf([[data, {}]], prim, accessors, ['KHR_draco_mesh_compression']);
  assert.throws(() => parseGLTF(file), (e: Error & { code?: string }) => e.code === 'DRACO_DECODER_NEEDED' && /createDracoDecoder/.test(e.message));

  const m = parseGLTF(file, { draco: await createDracoDecoder() });
  // draco drops the triangles that collapse to a point at the poles
  const t = m.indices.length / 3;
  assert.ok(t <= n / 3 && t > (n / 3) * 0.95, `${t} triangles`);
  // every corner is still on the sphere of radius 2, and colors came through as 0..1
  for (let v = 0; v < m.positions.length / 3; v++) assert.ok(Math.abs(Math.hypot(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]) - 2) < 1e-3);
  assert.ok(m.colors && m.colors.every((c) => c >= 0 && c <= 1) && m.colors.some((c) => c > 0 && c < 1));
  // the triangles are the same set of positions as before, up to quantization
  const key = (P: Float32Array, I: ArrayLike<number>, t: number) => [0, 1, 2].map((k) => [0, 1, 2].map((a) => Math.round(P[I[t * 3 + k] * 3 + a] * 100)).join(',')).sort().join('|');
  const before = new Set(Array.from({ length: n / 3 }, (_, t) => key(s.pos, s.idx, t)));
  let found = 0;
  for (let k = 0; k < t; k++) if (before.has(key(m.positions, m.indices, k))) found++;
  assert.equal(found, t, 'every triangle is one of the originals');
});
