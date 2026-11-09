// <textel-viewer>: the DOM-free logic, the fit for tilting, and the element in happy-dom.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { drag, gridFor, step, styleFromAttributes, type Motion } from '../src/browser/viewer-core.ts';
import { buildExample, EXAMPLES } from '../src/examples.ts';
import type { Mesh } from '../src/mesh.ts';
import { toText } from '../src/output.ts';
import { createRenderer } from '../src/render.ts';

test('viewer: the grid follows the font and the box', () => {
  // 10x20 cells: a square box needs half as many rows as columns
  let g = gridFor(100, 10, 20, 1000, 1000);
  assert.deepEqual([g.cols, g.rows, g.aspect, g.scale], [100, 50, 2, 1]);
  assert.equal(g.ratio, 1);
  // a wide box gets fewer rows; a box without a height is square
  assert.equal(gridFor(100, 10, 20, 1000, 500).rows, 25);
  assert.equal(gridFor(100, 10, 20, 1000, 0).rows, 50);
  // a squatter font gets more rows, never a stretched picture
  g = gridFor(100, 10, 15, 1000, 1000);
  assert.equal(g.rows, 67);
  assert.equal(g.aspect, 1.5);
  // nonsense in, something sane out
  g = gridFor(2, 0, 0, 0, 0);
  assert.ok(g.cols >= 8 && g.rows >= 4 && Number.isFinite(g.scale));
});

test('viewer: a flick coasts and eases back to the resting spin and tilt', () => {
  const target = { spin: 0.66, pitch: 0.3, maxPitch: 1.2 };
  let m: Motion = { yaw: 0, pitch: 0.3, vyaw: 0, vpitch: 0 };
  m = drag(m, 300, 60, 0.05, 600, 1.2);
  assert.ok(Math.abs(m.yaw - Math.PI) < 1e-9, 'half the width is half a turn');
  assert.ok(m.vyaw > 10, 'fast flick');
  for (let i = 0; i < 300; i++) m = step(m, target, 1 / 60);
  assert.ok(Math.abs(m.vyaw - 0.66) < 0.01, `back to the resting spin, ${m.vyaw}`);
  assert.ok(Math.abs(m.pitch - 0.3) < 0.02, `back to the resting tilt, ${m.pitch}`);
  // tilt never passes the limit
  m = drag(m, 0, 10000, 0.05, 600, 1.2);
  assert.equal(m.pitch, 1.2);
  // a frozen tab does not fling the model
  const before = m.yaw;
  m = step({ ...m, vyaw: 0.66 }, target, 30);
  assert.ok(m.yaw - before < 0.1);
});

test('viewer: attributes map onto style fields', () => {
  const attrs: Record<string, string> = { charset: 'hard', color: '#301000, #ffb000', edges: '', spin: '0', pitch: 'x' };
  const s = styleFromAttributes((n) => attrs[n] ?? null);
  assert.deepEqual(s, { charset: 'hard', color: ['#301000', '#ffb000'], edges: 'outline', spin: 0 });
  assert.equal(styleFromAttributes((n) => (n === 'edges' ? 'off' : null)).edges, false);
  assert.equal(styleFromAttributes((n) => (n === 'edges' ? 'crease' : null)).edges, 'crease');
});

test('fitPitch keeps a tall model inside the grid while it is tilted', () => {
  const rocket = EXAMPLES.find((e) => e.name === 'rocket')!;
  const mesh = buildExample(rocket);
  const edgeHit = (fitPitch: number) => {
    const r = createRenderer(mesh, { width: 60, height: 30, pitch: 0, fitPitch });
    let hit = false;
    for (const pitch of [-1.2, -0.6, 0.6, 1.2]) for (const yaw of [0, 1, 2, 3]) {
      const rows = toText(r.render({ yaw, pitch })).split('\n');
      if (rows[0].trim() || rows[rows.length - 1].trim()) hit = true;
    }
    return hit;
  };
  assert.equal(edgeHit(0), true, 'fitted for pitch 0 only, tilting clips');
  assert.equal(edgeHit(1.2), false, 'fitted for the whole range, nothing clips');
});

// ---------- the element ----------

type Viewer = HTMLElement & { mesh: Mesh | null; look: object; paused: boolean; play(): void; pause(): void; load(s: unknown, name?: string): Promise<void> };
const CUBE = 'v -1 -1 -1\nv 1 -1 -1\nv 1 1 -1\nv -1 1 -1\nv -1 -1 1\nv 1 -1 1\nv 1 1 1\nv -1 1 1\nf 1 2 3 4\nf 5 8 7 6\nf 1 5 6 2\nf 4 3 7 8\nf 1 4 8 5\nf 2 6 7 3\n';
let realFetch: typeof fetch;

before(async () => {
  GlobalRegistrator.register({ url: 'http://localhost/' });
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const path = new URL(url, 'http://localhost/').pathname;
    const files: Record<string, string> = { '/cube.obj': CUBE, '/look.json': JSON.stringify({ charset: 'blocks' }) };
    const body = files[path];
    const enc = new TextEncoder().encode(body ?? '');
    return {
      ok: body !== undefined, status: body ? 200 : 404, statusText: body ? 'OK' : 'Not Found',
      arrayBuffer: async () => enc.buffer, json: async () => JSON.parse(body!),
    } as unknown as Response;
  }) as typeof fetch;
  await import('../src/browser/viewer.ts');
});
after(async () => {
  globalThis.fetch = realFetch;
  await GlobalRegistrator.unregister();
});

const mount = (attrs: Record<string, string> = {}) => {
  const el = document.createElement('textel-viewer') as Viewer;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.append(el);
  return el;
};
const screen = (el: Viewer) => el.shadowRoot!.querySelector('pre[part=screen]')!;
const once = (el: Viewer, type: string) => new Promise<CustomEvent>((r) => el.addEventListener(type, (e) => r(e as unknown as CustomEvent), { once: true }));

test('viewer dom: loads a model from src and draws it', async () => {
  const el = mount({ paused: '', cols: '40' });
  const loaded = once(el, 'load');
  el.setAttribute('src', '/cube.obj');
  assert.equal((await loaded).detail.triangles, 12);
  assert.ok(screen(el).textContent!.trim().length > 0, 'something drawn');
  assert.equal(screen(el).textContent!.split('\n')[0].length, 40, '40 columns');
  assert.equal(el.getAttribute('role'), 'img');
  assert.equal(el.tabIndex, 0, 'focusable for the keyboard');
  el.remove();
});

test('viewer dom: keys turn it, attributes and presets restyle it', async () => {
  const el = mount({ paused: '', cols: '40' });
  el.mesh = buildExample(EXAMPLES.find((e) => e.name === 'dice')!);
  const before = screen(el).textContent;
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  await new Promise((r) => setTimeout(r, 60));
  assert.notEqual(screen(el).textContent, before, 'turned');

  el.setAttribute('color', '#ff0000');
  assert.match(screen(el).innerHTML, /color:#ff0000/);
  const styled = new Promise((r) => setTimeout(r, 80));
  el.setAttribute('preset', '/look.json');
  await styled;
  assert.match(screen(el).textContent!, /[░▒▓█]/, 'blocks charset from the preset');
  el.look = { charset: 'classic' };
  assert.doesNotMatch(screen(el).textContent!, /[░▒▓█]/, '.look wins over the preset');
  el.remove();
});

test('viewer dom: space pauses at once, and plays again', async () => {
  const el = mount({ cols: '40' });
  el.mesh = buildExample(EXAMPLES.find((e) => e.name === 'gem')!);
  // let it spin up first
  const spinning = performance.now() + 2000;
  let first = screen(el).textContent;
  while (screen(el).textContent === first && performance.now() < spinning) await new Promise((r) => setTimeout(r, 20));
  assert.notEqual(screen(el).textContent, first, 'spinning before the pause');

  el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
  assert.equal(el.paused, true);
  await new Promise((r) => setTimeout(r, 50));
  first = screen(el).textContent;
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(screen(el).textContent, first, 'no coasting after the pause');

  el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
  assert.equal(el.paused, false);
  el.remove();
});

test('viewer dom: two fingers pinch to zoom when zoomable', async () => {
  const ink = (el: Viewer) => screen(el).textContent!.replace(/\s/g, '').length;
  const finger = (el: Viewer, type: string, id: number, x: number) =>
    el.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: 100, button: 0, bubbles: true }));
  const pinch = (el: Viewer) => {
    finger(el, 'pointerdown', 1, 100);
    finger(el, 'pointerdown', 2, 140);
    finger(el, 'pointermove', 2, 220); // twice as far apart
    finger(el, 'pointerup', 2, 220);
    finger(el, 'pointerup', 1, 100);
  };
  for (const zoomable of [true, false]) {
    const el = mount({ paused: '', cols: '60', ...(zoomable ? { zoomable: '' } : {}) });
    el.mesh = buildExample(EXAMPLES.find((e) => e.name === 'gem')!);
    const before = ink(el);
    pinch(el);
    await new Promise((r) => setTimeout(r, 60));
    if (zoomable) assert.ok(ink(el) > before * 1.5, `zoomed in: ${before} -> ${ink(el)}`);
    else assert.ok(ink(el) < before * 1.5, `not zoomable, so no zoom: ${before} -> ${ink(el)}`);
    el.remove();
  }
});

test('viewer dom: view tells the camera as drawn, enough to draw it again', async () => {
  const el = mount({ paused: '', cols: '40', zoom: '1.5', pitch: '0.2' }) as Viewer & { view: { yaw: number; pitch: number; zoom: number; fitPitch: number } };
  el.mesh = buildExample(EXAMPLES.find((e) => e.name === 'gem')!);
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  const v = el.view;
  assert.ok(Math.abs(v.yaw - 0.3) < 1e-9, `two steps right: ${v.yaw}`);
  assert.equal(v.pitch, 0.2);
  assert.equal(v.zoom, 1.5);
  assert.equal(v.fitPitch, 1.2);
  el.setAttribute('nodrag', '');
  assert.equal(el.view.fitPitch, 0, 'a fixed viewer fits its one pitch');
  el.remove();
});

test('viewer dom: errors are events, not exceptions', async () => {
  const el = mount();
  const failed = once(el, 'error');
  el.setAttribute('src', '/missing.glb');
  assert.match(String((await failed).detail.error.message), /404/);
  const bad = once(el, 'error');
  await el.load(new TextEncoder().encode('not a model'), 'x.obj');
  assert.ok((await bad).detail.error instanceof Error);
  el.remove();
});
