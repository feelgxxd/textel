// Runs the real CLI in a child process, the way people use it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseFrames } from '../src/frames.ts';

const CLI = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'textel-cli-'));
after(() => rmSync(dir, { recursive: true, force: true }));

function textel(...args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '' } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('cli: help, version, list', () => {
  assert.match(textel().out, /commands[\s\S]*render[\s\S]*play/);
  assert.match(textel('help', 'render').out, /--frames/);
  assert.match(textel('--version').out, /^\d+\.\d+\.\d+/);
  assert.match(textel('list').out, /donut[\s\S]*charsets/);
});

test('cli: render writes a frames file and will not overwrite it', () => {
  const first = textel('render', '--example', 'donut', '--size', '40x16', '--frames', '12');
  assert.equal(first.code, 0, first.err);
  assert.match(first.err, /wrote donut\.textel\.json: 12 frames, 40x16/);
  const rec = parseFrames(readFileSync(join(dir, 'donut.textel.json'), 'utf8'));
  assert.equal(rec.frames.length, 12);
  assert.equal(rec.width, 40);
  assert.equal(rec.meta.title, 'DONUT');

  const again = textel('render', '--example', 'donut', '--size', '40x16', '--frames', '12');
  assert.equal(again.code, 1);
  assert.match(again.err, /exists; pass --force/);
  assert.equal(textel('render', '--example', 'donut', '--size', '40x16', '--frames', '6', '--force').code, 0);
  assert.equal(parseFrames(readFileSync(join(dir, 'donut.textel.json'), 'utf8')).frames.length, 6);

  assert.equal(textel('render', '--example', 'dice', '-o', 'sub-dice.json', '--size', '30x12', '--frames', '2').code, 0);
  assert.ok(existsSync(join(dir, 'sub-dice.json')));
});

test('cli: a played frame is exactly the frame preview draws', () => {
  assert.equal(textel('render', '--example', 'gem', '-o', 'gem.json', '--size', '50x20', '--frames', '8').code, 0);
  const played = textel('play', 'gem.json', '--once', '--frame', '0');
  const previewed = textel('--example', 'gem', '--once', '--yaw', '0', '--size', '50x20');
  assert.equal(played.code, 0, played.err);
  assert.equal(played.out, previewed.out);
  // frame 2 of 8 is a quarter turn's worth further: yaw = 2/8 of a full turn
  assert.equal(textel('play', 'gem.json', '--once', '--frame', '2').out, textel('--example', 'gem', '--once', '--yaw', String(Math.PI / 2), '--size', '50x20').out);
});

test('cli: clear errors', () => {
  assert.match(textel('play', 'missing.json').err, /cannot read missing\.json/);
  assert.match(textel('render', '--example', 'nope').err, /no example "nope"/);
  assert.match(textel('render', '--example', 'donut', '--frames', '0').err, /--frames is a whole number/);
  assert.match(textel('--example', 'donut', '--size', 'big').err, /--size looks like/);
  assert.match(textel('help', 'nope').err, /no command "nope"/);
});
