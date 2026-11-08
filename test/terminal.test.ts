// The terminal player against fake streams: no real terminal needed.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { buildExample, EXAMPLES } from '../src/examples.ts';
import { recordingText, recordLoop, type Recording } from '../src/frames.ts';
import { createRenderer } from '../src/render.ts';
import { detectColorDepth, play, playSplash } from '../src/terminal.ts';

class FakeOut extends EventEmitter {
  isTTY = true;
  columns = 70;
  rows = 24;
  data = '';
  write(s: string) { this.data += s; return true; }
}

class FakeIn extends EventEmitter {
  isTTY = true;
  raw = false;
  setRawMode(on: boolean) { this.raw = on; return this; }
  setEncoding() { return this; }
  resume() { return this; }
  pause() { return this; }
  key(k: string) { this.emit('data', k); }
}

const donut = EXAMPLES.find((e) => e.name === 'donut')!;
const rec: Recording = recordLoop(createRenderer(buildExample(donut), { ...donut.style, width: 40, height: 12 }), { frames: 4, fps: 120 });

const opened = (s: string) => s.startsWith('\x1b[?1049h');
const restored = (s: string) => s.endsWith('\x1b[?25h\x1b[?1049l');

test('terminal: plays to the end and restores the screen', async () => {
  const out = new FakeOut();
  assert.equal(await play(rec, { output: out, loop: false, depth: 'none' }), 'end');
  assert.ok(opened(out.data), 'alternate screen on');
  assert.ok(restored(out.data), 'cursor and screen restored');
  // the grid is centered in the 70x24 terminal: 15 columns of padding
  const firstRow = recordingText(rec, 0).split('\n').find((l) => l.trim())!;
  assert.ok(out.data.includes(' '.repeat(15) + firstRow), 'centered frame drawn');
});

test('terminal: keys quit and Ctrl+C interrupts; raw mode is undone', async () => {
  for (const [key, want] of [['q', 'quit'], ['\x03', 'interrupt']] as const) {
    const out = new FakeOut(), inp = new FakeIn();
    const p = play(rec, { output: out, input: inp, interactive: true, depth: 'none' });
    assert.equal(inp.raw, true);
    inp.key(key);
    assert.equal(await p, want);
    assert.equal(inp.raw, false);
    assert.ok(restored(out.data));
    assert.match(out.data, /frame \d\/4/, 'status line');
  }
});

test('terminal: an abort signal stops playback', async () => {
  const out = new FakeOut(), ac = new AbortController();
  const p = play(rec, { output: out, depth: 'none', signal: ac.signal });
  setTimeout(() => ac.abort(), 30);
  assert.equal(await p, 'abort');
  assert.ok(restored(out.data));
});

test('terminal: a splash ends after its time, or on any key', async () => {
  const out = new FakeOut();
  const t0 = performance.now();
  assert.equal(await playSplash(rec, { output: out, input: null, seconds: 0.1 }), 'end');
  assert.ok(performance.now() - t0 >= 90);
  assert.ok(!out.data.includes('frame 1/'), 'no status line on a splash');
  const out2 = new FakeOut(), inp = new FakeIn();
  const p = playSplash(rec, { output: out2, input: inp, seconds: 10 });
  inp.key('x');
  assert.equal(await p, 'quit');
});

test('terminal: output that is not a terminal gets one plain frame', async () => {
  const out = new FakeOut();
  out.isTTY = false;
  assert.equal(await play(rec, { output: out }), 'end');
  assert.equal(out.data, recordingText(rec, 0) + '\n');
  assert.equal(await playSplash(rec, { output: out }), 'end');
});

test('terminal: color depth detection', () => {
  const tty = { isTTY: true } as FakeOut, pipe = { isTTY: false } as FakeOut;
  assert.equal(detectColorDepth(tty, { NO_COLOR: '1' }), 'none');
  assert.equal(detectColorDepth(pipe, {}), 'none');
  assert.equal(detectColorDepth(pipe, { FORCE_COLOR: '1' }), '256');
  assert.equal(detectColorDepth(tty, { COLORTERM: 'truecolor' }), 'truecolor');
  assert.equal(detectColorDepth(tty, {}), '256');
});
