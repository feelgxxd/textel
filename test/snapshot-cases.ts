// Golden frames: every built-in example rendered at a fixed size and angle, plus a few style variants.
// A change that alters any picture fails the test until the snapshots are regenerated on purpose
// with `npm run snapshots`, so visual changes always show up in a diff.
import { buildExample, EXAMPLES } from '../src/examples.ts';
import type { Mesh } from '../src/mesh.ts';
import { toText } from '../src/output.ts';
import { createRenderer } from '../src/render.ts';
import { mergeStyles, type StyleInput } from '../src/style.ts';

export const SNAPSHOT_DIR = new URL('./snapshots/', import.meta.url);

interface Case {
  name: string;
  example: string;
  style?: StyleInput;
  yaw: number;
}

const SIZE: StyleInput = { width: 64, height: 26, aspect: 2 };

export const CASES: Case[] = [
  ...EXAMPLES.map((e) => ({ name: e.name, example: e.name, yaw: 0.6 })),
  { name: 'donut-edges-depth', example: 'donut', style: { edges: 'depth' }, yaw: 1.2 },
  { name: 'dice-blocks', example: 'dice', style: { charset: 'blocks' }, yaw: 2.2 },
  { name: 'rocket-flat-ambient', example: 'rocket', style: { shading: 'flat', ambient: 0.2 }, yaw: 3.5 },
  { name: 'planet-wide-aspect', example: 'planet', style: { aspect: 1.5, supersample: 3 }, yaw: 0.3 },
];

const meshes = new Map<string, Mesh>();

export function renderCase(c: Case): string {
  const ex = EXAMPLES.find((e) => e.name === c.example);
  if (!ex) throw new Error(`no example ${c.example}`);
  let mesh = meshes.get(ex.name);
  if (!mesh) { mesh = buildExample(ex); meshes.set(ex.name, mesh); }
  const r = createRenderer(mesh, mergeStyles(ex.style, SIZE, c.style));
  return toText(r.render({ yaw: c.yaw })) + '\n';
}
