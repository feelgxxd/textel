// <textel-player> in a simulated DOM (happy-dom).
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { buildExample, EXAMPLES } from '../src/examples.ts';
import { recordingText, recordLoop, toFramesFile, type Recording } from '../src/frames.ts';
import { createRenderer } from '../src/render.ts';
import { mergeStyles } from '../src/style.ts';

const gem = EXAMPLES.find((e) => e.name === 'gem')!;
const mesh = buildExample(gem);
const make = (extra = {}) => recordLoop(createRenderer(mesh, mergeStyles(gem.style, { width: 40, height: 16 }, extra)), { frames: 12, fps: 60, meta: { title: 'GEM' } });
const plain = make();
const colored = make({ color: ['#301000', '#ffb000'] });

type Player = HTMLElement & { recording: Recording | null; frame: number; paused: boolean; play(): void; pause(): void };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let realFetch: typeof fetch;

before(async () => {
  GlobalRegistrator.register({ url: 'http://localhost/' });
  realFetch = globalThis.fetch;
  await import('../src/browser/player.ts');
});
after(async () => {
  globalThis.fetch = realFetch;
  await GlobalRegistrator.unregister();
});

function mount(attrs: Record<string, string> = {}): Player {
  const el = document.createElement('textel-player') as Player;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.append(el);
  return el;
}
const screen = (el: Player) => el.shadowRoot!.querySelector('pre')!;

test('player dom: registers the element and draws the first frame', () => {
  const el = mount({ paused: '' });
  assert.ok(customElements.get('textel-player'));
  el.recording = plain;
  assert.equal(screen(el).textContent, recordingText(plain, 0));
  assert.equal(el.getAttribute('role'), 'img');
  assert.equal(el.getAttribute('aria-label'), 'GEM, ASCII animation');
  el.setAttribute('label', 'Spinning gem');
  assert.equal(el.getAttribute('aria-label'), 'Spinning gem');
  el.remove();
});

test('player dom: styled files render as spans; a raw frames file can be assigned', () => {
  const el = mount({ paused: '' });
  el.recording = toFramesFile(colored) as never;
  assert.match(screen(el).innerHTML, /<span style="color:#[0-9a-f]{6}">/);
  assert.equal(screen(el).textContent, recordingText(colored, 0));
  el.setAttribute('color', '#ff00aa');
  assert.equal(screen(el).style.color, '#ff00aa');
  el.remove();
});

test('player dom: paused stays put, play advances, frame wraps', async () => {
  const el = mount({ paused: '' });
  el.recording = plain;
  assert.equal(el.paused, true);
  await sleep(120);
  assert.equal(el.frame, 0);
  el.play();
  // wait for progress rather than a fixed time: timers run late on a busy CI machine
  const deadline = performance.now() + 3000;
  while (el.frame === 0 && performance.now() < deadline) await sleep(20);
  assert.ok(el.frame > 0, `advanced to ${el.frame}`);
  el.pause();
  el.frame = -1;
  assert.equal(el.frame, 11);
  assert.equal(screen(el).textContent, recordingText(plain, 11));
  el.removeAttribute('paused');
  assert.equal(el.paused, false);
  el.remove();
});

test('player dom: dragging scrubs, unless nodrag', () => {
  for (const nodrag of [false, true]) {
    const el = mount(nodrag ? { paused: '', nodrag: '' } : { paused: '' });
    el.recording = plain;
    Object.defineProperty(el, 'clientWidth', { value: 120 });
    el.setPointerCapture = () => {};
    el.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, button: 0, pointerId: 1 }));
    // half the width = half the loop
    el.dispatchEvent(new PointerEvent('pointermove', { clientX: 70, pointerId: 1 }));
    el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
    assert.equal(el.frame, nodrag ? 0 : 6);
    el.remove();
  }
});

test('player dom: src loads the file, with load and error events', async () => {
  const files: Record<string, unknown> = { '/gem.textel.json': toFramesFile(plain) };
  globalThis.fetch = (async (url: string) => {
    const body = files[new URL(url, 'http://localhost/').pathname];
    return { ok: !!body, status: body ? 200 : 404, statusText: body ? 'OK' : 'Not Found', json: async () => body } as Response;
  }) as typeof fetch;

  const el = mount({ paused: '' });
  const loaded = new Promise<CustomEvent>((r) => el.addEventListener('load', (e) => r(e as CustomEvent), { once: true }));
  el.setAttribute('src', '/gem.textel.json');
  assert.equal((await loaded).detail.frames, 12);
  assert.equal(screen(el).textContent, recordingText(plain, 0));

  const failed = new Promise<CustomEvent>((r) => el.addEventListener('error', (e) => r(e as unknown as CustomEvent), { once: true }));
  el.setAttribute('src', '/missing.json');
  assert.match(String((await failed).detail.error.message), /404/);
  el.remove();
});
