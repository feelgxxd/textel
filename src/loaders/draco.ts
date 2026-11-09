// Draco compressed glTF (KHR_draco_mesh_compression) through Google's draco3d package, which textel
// does not ship: install it next to textel. Kept out of the browser bundles.
import type { DracoDecode } from './gltf.ts';

type Module = any;

// glTF component types: the draco data type and the array it lands in
const TYPES: Record<number, [string, 'HEAP8' | 'HEAPU8' | 'HEAP16' | 'HEAPU16' | 'HEAPU32' | 'HEAPF32']> = {
  5120: ['DT_INT8', 'HEAP8'], 5121: ['DT_UINT8', 'HEAPU8'], 5122: ['DT_INT16', 'HEAP16'],
  5123: ['DT_UINT16', 'HEAPU16'], 5125: ['DT_UINT32', 'HEAPU32'], 5126: ['DT_FLOAT32', 'HEAPF32'],
};

/**
 * A Draco decoder for parseGLTF / parseModel (`{ draco }`). Pass the module from draco3d's
 * `createDecoderModule()`, or nothing to load the draco3d package.
 */
export async function createDracoDecoder(module?: Module): Promise<DracoDecode> {
  if (!module) {
    const name = 'draco3d';
    const pkg = await import(name);
    module = await (pkg.default ?? pkg).createDecoderModule({});
  }
  return dracoDecode(module);
}

function dracoDecode(d: Module): DracoDecode {
  return (data, attributes) => {
    const decoder = new d.Decoder(), buf = new d.DecoderBuffer(), mesh = new d.Mesh();
    // copy out of the wasm heap before freeing it, since the heap can move when it grows
    const take = (heap: string, ptr: number, n: number) => {
      const H = d[heap];
      return new H.constructor(H.buffer, ptr, n).slice();
    };
    try {
      buf.Init(new Int8Array(data.buffer, data.byteOffset, data.byteLength), data.byteLength);
      if (decoder.GetEncodedGeometryType(buf) !== d.TRIANGULAR_MESH) throw new Error('draco: not a triangle mesh');
      const status = decoder.DecodeBufferToMesh(buf, mesh);
      if (!status.ok() || !mesh.ptr) throw new Error(`draco: ${status.error_msg()}`);
      const n = mesh.num_faces() * 3, points = mesh.num_points();
      let ptr = d._malloc(n * 4);
      decoder.GetTrianglesUInt32Array(mesh, n * 4, ptr);
      const indices = take('HEAPU32', ptr, n) as Uint32Array;
      d._free(ptr);
      const out: Record<string, ArrayLike<number>> = {};
      for (const [name, a] of Object.entries(attributes)) {
        const attr = decoder.GetAttributeByUniqueId(mesh, a.id), [type, heap] = TYPES[a.componentType] ?? TYPES[5126];
        if (!attr.ptr) throw new Error(`draco: no attribute ${a.id} for ${name}`);
        const count = points * a.components, bytes = count * d[heap].BYTES_PER_ELEMENT;
        ptr = d._malloc(bytes);
        decoder.GetAttributeDataArrayForAllPoints(mesh, attr, d[type], bytes, ptr);
        out[name] = take(heap, ptr, count);
        d._free(ptr);
      }
      return { indices, attributes: out };
    } finally {
      d.destroy(mesh); d.destroy(buf); d.destroy(decoder);
    }
  };
}
