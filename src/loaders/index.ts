import type { Mesh } from '../mesh.ts';
import { parseGLTF, type GltfOptions } from './gltf.ts';
import { parseOBJ } from './obj.ts';
import { parseSTL } from './stl.ts';

export { parseGLTF, parseOBJ, parseSTL };

export const MODEL_EXTENSIONS = ['.glb', '.gltf', '.obj', '.stl'];

/** Picks a parser from the file name, falling back to sniffing the bytes. */
export function parseModel(bytes: Uint8Array, filename = '', opts: GltfOptions = {}): Mesh {
  const ext = filename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '';
  if (ext === '.glb' || ext === '.gltf') return parseGLTF(bytes, opts);
  if (ext === '.obj') return parseOBJ(new TextDecoder().decode(bytes));
  if (ext === '.stl') return parseSTL(bytes);
  // no or unknown extension
  if (bytes.length >= 4 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46) return parseGLTF(bytes, opts);
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart();
  if (head.startsWith('{')) return parseGLTF(bytes, opts);
  if (/^(v|vn|vt|o|g|mtllib|#)\s/m.test(head)) return parseOBJ(new TextDecoder().decode(bytes));
  return parseSTL(bytes);
}
