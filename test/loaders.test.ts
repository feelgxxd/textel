import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseGLTF, parseModel, parseOBJ, parseSTL } from '../src/loaders/index.ts';

const CUBE_OBJ = `
# unit cube, quads
v -1 -1 -1
v  1 -1 -1
v  1  1 -1
v -1  1 -1
v -1 -1  1
v  1 -1  1
v  1  1  1
v -1  1  1
usemtl red
f 1 2 3 4
f 5 8 7 6
usemtl blue
f 1 5 6 2
f 4 3 7 8
f -8 -4 -1 -5
f 2 6 7 3
`;

test('obj: quads are triangulated, materials kept, negative indices work', () => {
  const m = parseOBJ(CUBE_OBJ);
  assert.equal(m.indices.length / 3, 12);
  assert.deepEqual(m.materials, ['red', 'blue']);
  assert.equal(m.triMaterial[0], 0);
  assert.equal(m.triMaterial[11], 1);
  assert.equal(m.normals, null);
});

test('obj: v//vn faces keep normals', () => {
  const m = parseOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nvn 0 0 1\nf 1//1 2//1 3//1\n');
  assert.ok(m.normals);
  assert.deepEqual([...m.normals!.slice(0, 3)], [0, 0, 1]);
});

test('obj: bad index is a clear error', () => {
  assert.throws(() => parseOBJ('v 0 0 0\nf 1 2 3\n'), /bad vertex index/);
});

function binarySTL(tris: number[][]): Uint8Array {
  const buf = new ArrayBuffer(84 + tris.length * 50), dv = new DataView(buf);
  dv.setUint32(80, tris.length, true);
  tris.forEach((t, i) => t.forEach((v, k) => dv.setFloat32(84 + i * 50 + 12 + k * 4, v, true)));
  return new Uint8Array(buf);
}

test('stl: binary and ascii', () => {
  const tri = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  const bin = parseSTL(binarySTL([tri, tri]));
  assert.equal(bin.indices.length, 6);
  assert.equal(bin.positions[3], 1);
  const ascii = parseSTL(new TextEncoder().encode('solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid x\n'));
  assert.equal(ascii.indices.length, 3);
});

/** a GLB with one triangle under a translated node, with normals and a named material */
function tinyGLB(): Uint8Array {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const nor = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const idx = new Uint16Array([0, 1, 2, 0]); // padded to 4 bytes
  const bin = new Uint8Array(pos.byteLength + nor.byteLength + idx.byteLength);
  bin.set(new Uint8Array(pos.buffer), 0);
  bin.set(new Uint8Array(nor.buffer), 36);
  bin.set(new Uint8Array(idx.buffer), 72);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ translation: [10, 0, 0], children: [1] }, { mesh: 0, scale: [2, 2, 2] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ name: 'Gold' }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 36 },
      { buffer: 0, byteOffset: 72, byteLength: 6 },
    ],
    buffers: [{ byteLength: bin.byteLength }],
  };
  let js = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (js.length % 4)) % 4;
  js = new Uint8Array([...js, ...new Array(pad).fill(0x20)]);
  const total = 12 + 8 + js.length + 8 + bin.length;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, js.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(js, 20);
  const o = 20 + js.length;
  dv.setUint32(o, bin.length, true); dv.setUint32(o + 4, 0x004e4942, true); out.set(bin, o + 8);
  return out;
}

test('glb: node transforms, normals and material names', () => {
  const m = parseGLTF(tinyGLB());
  assert.equal(m.indices.length, 3);
  assert.deepEqual(m.materials, ['Gold']);
  // vertex 1 is (1,0,0) scaled by 2 then moved by 10
  assert.deepEqual([...m.positions.slice(3, 6)], [12, 0, 0]);
  assert.ok(m.normals);
  assert.ok(Math.abs(m.normals![2] - 1) < 1e-6);
});

test('glb: compressed files are rejected with a useful message', () => {
  const json = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, extensionsRequired: ['KHR_draco_mesh_compression'] }));
  assert.throws(() => parseGLTF(json), /not supported yet/);
});

test('parseModel picks the parser by extension or content', () => {
  assert.equal(parseModel(new TextEncoder().encode(CUBE_OBJ), 'cube.obj').indices.length, 36);
  assert.equal(parseModel(new TextEncoder().encode(CUBE_OBJ)).indices.length, 36);
  assert.equal(parseModel(tinyGLB(), 'x.bin').indices.length, 3);
});

test('parseModelAsync gives the same mesh as parseModel and lets the event loop run', async () => {
  const { parseModelAsync } = await import('../src/loaders/index.ts');
  // a big OBJ: a grid of quads, ~120k triangles
  const N = 245, lines: string[] = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) lines.push(`v ${i} ${j} ${Math.sin(i / 9) * Math.cos(j / 7)}`);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i + 1;
    lines.push(`f ${a} ${a + 1} ${a + N + 2} ${a + N + 1}`);
  }
  const bytes = new TextEncoder().encode(lines.join('\n'));
  let ticks = 0;
  const timer = setInterval(() => ticks++, 1);
  const async = await parseModelAsync(bytes, 'grid.obj', {}, 4);
  clearInterval(timer);
  const sync = parseModel(bytes, 'grid.obj');
  assert.equal(async.indices.length, N * N * 6);
  assert.deepEqual(async.indices, sync.indices);
  assert.deepEqual(async.positions, sync.positions);
  assert.ok(ticks > 0, 'timers ran while it parsed');
});

test('gltf: base colors and vertex colors, converted to sRGB', () => {
  // two triangles: one with a vertex color per corner, one with only its material's base color
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const col = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
  const bin = new Uint8Array(48);
  bin.set(new Uint8Array(pos.buffer), 0);
  bin.set(col, 36);
  const json = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, COLOR_0: 1 }, material: 0 }, { attributes: { POSITION: 0 }, material: 1 }] }],
    materials: [{ name: 'Painted' }, { name: 'Grey', pbrMetallicRoughness: { baseColorFactor: [0.2, 0.2, 0.2, 1] } }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5121, normalized: true, count: 3, type: 'VEC4' },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 12 }],
    buffers: [{ byteLength: 48, uri: 'data:application/octet-stream;base64,' + Buffer.from(bin).toString('base64') }],
  };
  const m = parseGLTF(new TextEncoder().encode(JSON.stringify(json)));
  assert.deepEqual(m.materials, ['Painted', 'Grey']);
  assert.deepEqual(m.materialColors![0], [1, 1, 1], 'white when the material does not say');
  assert.ok(Math.abs(m.materialColors![1]![0] - 0.4845) < 1e-3, 'linear 0.2 is sRGB 0.48');
  assert.deepEqual([...m.colors!.slice(0, 9)], [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  assert.deepEqual([...m.colors!.slice(9, 18)], [1, 1, 1, 1, 1, 1, 1, 1, 1], 'no vertex colors: white, times the base color');
  assert.equal(m.textured, false);
  // a base color texture is not read, but the mesh says it has one
  json.materials[1].pbrMetallicRoughness = { baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: 0 } } as never;
  assert.equal(parseGLTF(new TextEncoder().encode(JSON.stringify(json))).textured, true);
});

test('obj: vertex colors, and diffuse colors from the material library', () => {
  const obj = 'mtllib parts.mtl\nv 0 0 0 1 0 0\nv 1 0 0 0 255 0\nv 0 1 0\nusemtl Paint\nf 1 2 3\nusemtl Bare\nf 1 3 2\n';
  const mtl = 'newmtl Paint\nKd 0.2 0.4 0.6\nnewmtl Bare\nNs 10\n';
  const m = parseOBJ(obj, { resolve: (uri) => { assert.equal(uri, 'parts.mtl'); return new TextEncoder().encode(mtl); } });
  assert.deepEqual(m.materialColors, [[0.2, 0.4, 0.6], null]);
  assert.deepEqual([...m.colors!.slice(0, 9)], [1, 0, 0, 0, 1, 0, 1, 1, 1], '0..255 is read too; no color is white');
  // without the library the model still loads, without material colors
  const bare = parseOBJ(obj, { resolve: () => { throw new Error('not found'); } });
  assert.deepEqual(bare.materialColors, [null, null]);
  assert.equal(parseOBJ(CUBE_OBJ).colors, null);
  assert.equal(m.textured, false);
  const textured = parseOBJ(obj, { resolve: () => new TextEncoder().encode('newmtl Paint\nKd 1 1 1\nmap_Kd paint.png\n') });
  assert.equal(textured.textured, true, 'map_Kd marks the mesh as textured');
});
