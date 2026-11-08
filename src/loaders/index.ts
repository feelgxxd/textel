import type { Mesh } from '../mesh.ts';
import { parseGLTF, type GltfOptions } from './gltf.ts';
import { parseOBJ, parseOBJSteps } from './obj.ts';
import { parseSTL } from './stl.ts';

export { parseGLTF, parseOBJ, parseOBJSteps, parseSTL };

export const MODEL_EXTENSIONS = ['.glb', '.gltf', '.obj', '.stl'];

type Kind = 'gltf' | 'obj' | 'stl';

/** from the file name, falling back to sniffing the bytes */
function kindOf(bytes: Uint8Array, filename: string): Kind {
  const ext = filename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '';
  if (ext === '.glb' || ext === '.gltf') return 'gltf';
  if (ext === '.obj') return 'obj';
  if (ext === '.stl') return 'stl';
  if (bytes.length >= 4 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46) return 'gltf';
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart();
  if (head.startsWith('{')) return 'gltf';
  if (/^(v|vn|vt|o|g|mtllib|#)\s/m.test(head)) return 'obj';
  return 'stl';
}

/**
 * Parsing as a generator that yields now and then. Only text formats yield: binary glTF and STL
 * are fast enough to parse in one go.
 */
export function* parseModelSteps(bytes: Uint8Array, filename = '', opts: GltfOptions = {}): Generator<void, Mesh> {
  const kind = kindOf(bytes, filename);
  if (kind === 'obj') return yield* parseOBJSteps(new TextDecoder().decode(bytes));
  return kind === 'gltf' ? parseGLTF(bytes, opts) : parseSTL(bytes);
}

/** Picks a parser from the file name, falling back to sniffing the bytes. */
export function parseModel(bytes: Uint8Array, filename = '', opts: GltfOptions = {}): Mesh {
  const g = parseModelSteps(bytes, filename, opts);
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}

/**
 * parseModel without freezing a page: works in slices of about `sliceMs` and lets the event loop
 * run between them, so input and animation keep going while a large file loads.
 */
export async function parseModelAsync(bytes: Uint8Array, filename = '', opts: GltfOptions = {}, sliceMs = 12): Promise<Mesh> {
  const g = parseModelSteps(bytes, filename, opts);
  let t = performance.now();
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
    if (performance.now() - t > sliceMs) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      t = performance.now();
    }
  }
}
