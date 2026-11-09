import { MeshBuilder, type Mesh } from '../mesh.ts';
import { decodeMeshopt, type MeshoptView } from './meshopt.ts';

type Compressed = { buffer: number; byteOffset?: number; byteLength: number } & MeshoptView;

// The parts of glTF 2.0 we read
interface GltfJson {
  asset?: { version?: string };
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: { children?: number[]; mesh?: number; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  meshes?: { primitives: {
    attributes: Record<string, number>; indices?: number; material?: number; mode?: number;
    extensions?: { KHR_draco_mesh_compression?: { bufferView: number; attributes: Record<string, number> } };
  }[] }[];
  materials?: { name?: string; pbrMetallicRoughness?: { baseColorFactor?: number[]; baseColorTexture?: unknown } }[];
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; normalized?: boolean; count: number; type: string }[];
  bufferViews?: {
    buffer: number; byteOffset?: number; byteLength: number; byteStride?: number;
    extensions?: { EXT_meshopt_compression?: Compressed; KHR_meshopt_compression?: Compressed };
  }[];
  buffers?: { uri?: string; byteLength: number }[];
  extensionsRequired?: string[];
}

/**
 * Decodes one Draco compressed primitive: its triangle indices, and for each attribute name its
 * values, `components` per point in the accessor's own component type (not normalized).
 * `createDracoDecoder()` from `@feelgxxd/textel/draco` makes one.
 */
export type DracoDecode = (
  data: Uint8Array,
  attributes: Record<string, { id: number; components: number; componentType: number }>,
) => { indices: Uint32Array; attributes: Record<string, ArrayLike<number>> };

export interface GltfOptions {
  /** loads an external buffer (`.gltf` with a separate `.bin`) by its uri */
  resolve?: (uri: string) => Uint8Array;
  /** reads Draco compressed meshes; without it they are an error with `code` 'DRACO_DECODER_NEEDED' */
  draco?: DracoDecode;
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

/** `.glb` (binary) or `.gltf` (JSON) bytes. Applies node transforms; all triangle primitives go into one mesh. */
export function parseGLTF(bytes: Uint8Array, opts: GltfOptions = {}): Mesh {
  let json: GltfJson, bin: Uint8Array | null = null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 12 && dv.getUint32(0, true) === 0x46546c67) {
    // GLB: header, then a JSON chunk and an optional BIN chunk
    let o = 12;
    json = {} as GltfJson;
    while (o + 8 <= bytes.length) {
      const len = dv.getUint32(o, true), type = dv.getUint32(o + 4, true);
      const body = bytes.subarray(o + 8, o + 8 + len);
      if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body));
      else if (type === 0x004e4942) bin = body;
      o += 8 + len;
    }
  } else {
    json = JSON.parse(new TextDecoder().decode(bytes));
  }

  // quantized attributes (KHR_mesh_quantization) are fine: `read` handles every component type.
  // Buffers are loaded when first used: a meshopt fallback buffer may have no data at all.
  const buffers: Uint8Array[] = [];
  const buffer = (i: number) => {
    if (buffers[i]) return buffers[i];
    const buf = json.buffers?.[i];
    if (!buf) throw new Error(`missing buffer ${i}`);
    if (buf.uri === undefined) {
      if (!bin) throw new Error(`buffer ${i} has no data`);
      return (buffers[i] = bin);
    }
    const m = /^data:[^,]*;base64,(.*)$/.exec(buf.uri);
    if (m) return (buffers[i] = base64(m[1]));
    if (!opts.resolve) throw new Error(`external buffer "${buf.uri}" needs a resolver`);
    return (buffers[i] = opts.resolve(decodeURIComponent(buf.uri)));
  };
  // a buffer view's bytes and stride, decoded when it is meshopt compressed
  const views: { bytes: Uint8Array; stride: number }[] = [];
  const view = (i: number) => {
    if (views[i]) return views[i];
    const bv = json.bufferViews?.[i];
    if (!bv) throw new Error(`missing buffer view ${i}`);
    const c = bv.extensions?.EXT_meshopt_compression ?? bv.extensions?.KHR_meshopt_compression;
    const slice = (s: { buffer: number; byteOffset?: number; byteLength: number }) => buffer(s.buffer).subarray(s.byteOffset ?? 0, (s.byteOffset ?? 0) + s.byteLength);
    return (views[i] = c ? { bytes: decodeMeshopt(slice(c), c), stride: c.byteStride } : { bytes: slice(bv), stride: bv.byteStride ?? 0 });
  };

  // normalized integers become -1..1 or 0..1
  const unit = (ct: number) => (ct === 5123 ? 65535 : ct === 5122 ? 32767 : ct === 5121 ? 255 : ct === 5120 ? 127 : 1);
  const read = (index: number, raw?: ArrayLike<number>): { data: Float32Array; size: number; count: number } => {
    const acc = json.accessors?.[index];
    if (!acc) throw new Error(`missing accessor ${index}`);
    const size = COMPONENTS[acc.type] ?? 1, out = new Float32Array(acc.count * size), ct = acc.componentType;
    const k = acc.normalized ? 1 / unit(ct) : 0;
    if (raw) {
      // decoded data: trust its own length over the accessor's count
      const count = Math.floor(raw.length / size), data = new Float32Array(count * size);
      for (let i = 0; i < data.length; i++) data[i] = k ? Math.max(raw[i] * k, -1) : raw[i];
      return { data, size, count };
    }
    if (acc.bufferView === undefined) return { data: out, size, count: acc.count };
    const { bytes, stride: bs } = view(acc.bufferView);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const csize = ct === 5126 || ct === 5125 ? 4 : ct === 5123 || ct === 5122 ? 2 : 1;
    const stride = bs || csize * size, base = acc.byteOffset ?? 0;
    for (let e = 0; e < acc.count; e++) for (let c = 0; c < size; c++) {
      const o = base + e * stride + c * csize;
      let x: number;
      switch (ct) {
        case 5126: x = dv.getFloat32(o, true); break;
        case 5125: x = dv.getUint32(o, true); break;
        case 5123: x = dv.getUint16(o, true); break;
        case 5122: x = dv.getInt16(o, true); break;
        case 5121: x = dv.getUint8(o); break;
        case 5120: x = dv.getInt8(o); break;
        default: throw new Error(`unknown component type ${ct}`);
      }
      out[e * size + c] = k ? Math.max(x * k, -1) : x;
    }
    return { data: out, size, count: acc.count };
  };

  // a Draco primitive: decode it once, then read its attributes like any other accessor
  const draco = (prim: NonNullable<GltfJson['meshes']>[number]['primitives'][number]) => {
    const ext = prim.extensions?.KHR_draco_mesh_compression;
    if (!ext) return null;
    if (!opts.draco) {
      throw Object.assign(new Error('this glTF uses Draco compression, which needs a decoder: see createDracoDecoder in @feelgxxd/textel/draco'), { code: 'DRACO_DECODER_NEEDED' });
    }
    const want: Parameters<DracoDecode>[1] = {};
    for (const [name, id] of Object.entries(ext.attributes)) {
      const acc = json.accessors?.[prim.attributes[name]];
      if (acc) want[name] = { id, components: COMPONENTS[acc.type] ?? 1, componentType: acc.componentType };
    }
    return opts.draco(view(ext.bufferView).bytes, want);
  };

  const b = new MeshBuilder();
  const matName = (i: number | undefined) => (i === undefined ? 'default' : json.materials?.[i]?.name || `material${i}`);
  // base colors are linear in glTF; white when a material does not say
  const baseColor = (i: number | undefined) => {
    const f = i === undefined ? undefined : json.materials?.[i]?.pbrMetallicRoughness?.baseColorFactor;
    return [0, 1, 2].map((k) => (f && Number.isFinite(f[k]) ? Math.min(1, Math.max(0, f[k])) : 1));
  };
  const visit = (ni: number, parent: number[], depth: number) => {
    if (depth > 64) throw new Error('node hierarchy too deep');
    const node = json.nodes?.[ni];
    if (!node) return;
    const world = mul(parent, local(node));
    if (node.mesh !== undefined) addMesh(node.mesh, world);
    for (const c of node.children ?? []) visit(c, world, depth + 1);
  };

  const addMesh = (mi: number, M: number[]) => {
    const nm = normalMatrix(M);
    for (const prim of json.meshes?.[mi]?.primitives ?? []) {
      const mode = prim.mode ?? 4;
      if (mode !== 4 && mode !== 5 && mode !== 6) continue; // points and lines
      if (prim.attributes.POSITION === undefined) continue;
      const dr = draco(prim);
      const attr = (name: string) => (prim.attributes[name] === undefined ? null : read(prim.attributes[name], dr?.attributes[name]));
      const pos = attr('POSITION')!, nor = attr('NORMAL');
      const mat = b.material(matName(prim.material)), base = baseColor(prim.material);
      b.materialColor(mat, [toSRGB(base[0]), toSRGB(base[1]), toSRGB(base[2])]);
      if (prim.material !== undefined && json.materials?.[prim.material]?.pbrMetallicRoughness?.baseColorTexture) b.textured = true;
      const col = attr('COLOR_0');
      const first = b.positions.length / 3;
      for (let v = 0; v < pos.count; v++) {
        const x = pos.data[v * 3], y = pos.data[v * 3 + 1], z = pos.data[v * 3 + 2];
        const X = M[0] * x + M[4] * y + M[8] * z + M[12], Y = M[1] * x + M[5] * y + M[9] * z + M[13], Z = M[2] * x + M[6] * y + M[10] * z + M[14];
        if (nor) {
          const a = nor.data[v * 3], bb = nor.data[v * 3 + 1], c = nor.data[v * 3 + 2];
          b.vertex(X, Y, Z, nm[0] * a + nm[3] * bb + nm[6] * c, nm[1] * a + nm[4] * bb + nm[7] * c, nm[2] * a + nm[5] * bb + nm[8] * c);
        } else b.vertex(X, Y, Z);
        // the renderer multiplies these by the material's base color
        if (col) b.vertexColor(first + v, toSRGB(col.data[v * col.size]), toSRGB(col.data[v * col.size + 1]), toSRGB(col.data[v * col.size + 2]));
      }
      const idx = dr ? dr.indices : prim.indices !== undefined ? read(prim.indices).data : null;
      const n = idx ? idx.length : pos.count;
      const get = (k: number) => first + (idx ? idx[k] : k);
      if (mode === 4) for (let k = 0; k + 2 < n; k += 3) b.triangle(get(k), get(k + 1), get(k + 2), mat);
      else if (mode === 5) for (let k = 0; k + 2 < n; k++) k % 2 ? b.triangle(get(k + 1), get(k), get(k + 2), mat) : b.triangle(get(k), get(k + 1), get(k + 2), mat);
      else for (let k = 1; k + 1 < n; k++) b.triangle(get(0), get(k), get(k + 1), mat);
    }
  };

  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const scene = json.scenes?.[json.scene ?? 0];
  let roots = scene?.nodes;
  if (!roots) {
    // no scene: every node that is nobody's child
    const kids = new Set((json.nodes ?? []).flatMap((n) => n.children ?? []));
    roots = (json.nodes ?? []).map((_, i) => i).filter((i) => !kids.has(i));
  }
  for (const r of roots) visit(r, I, 0);
  if (!b.indices.length) throw new Error('no triangle meshes found in the glTF');
  return b.build();
}

/** a linear color channel to sRGB, both 0..1 */
export function toSRGB(x: number): number {
  const v = Math.min(1, Math.max(0, x));
  return v <= 0.0031308 ? v * 12.92 : v >= 1 ? 1 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/** column-major 4x4 */
function mul(a: number[], b: number[]): number[] {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

function local(n: { matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }): number[] {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation ?? [0, 0, 0], [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

/** inverse transpose of the upper 3x3, column-major 3x3 */
function normalMatrix(m: number[]): number[] {
  const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C || 1;
  // cofactor matrix / det = inverse transpose
  return [A / det, B / det, C / det, -(b * i - c * h) / det, (a * i - c * g) / det, -(a * h - b * g) / det, (b * f - c * e) / det, -(a * f - c * d) / det, (a * e - b * d) / det];
}

function base64(s: string): Uint8Array {
  if (typeof atob === 'function') return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  throw new Error('base64 decoding is not available');
}
