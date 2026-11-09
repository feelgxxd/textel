// The playground's DOM-free parts: share links, snippets, CLI commands, light angles.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  anglesFromLight, cliCommand, decodeState, DEFAULT_STATE, embedSnippet, encodeState, lightFromAngles, needsPreset, presetJSON, PRESETS, standaloneHTML, VERSION, type State,
} from '../site/src/state.ts';

const state = (look: State['look'], extra: Partial<State> = {}): State => ({ ...DEFAULT_STATE, look, ...extra });

test('site: share links round trip and stay short', async () => {
  const s = state({ charset: 'hard', color: ['#2a1400', '#ffb000'], edges: 'depth', pitch: 0.4, materials: { Glass: 'carved' } }, { cols: 120, example: 'rocket' });
  const hash = await encodeState(s);
  assert.match(hash, /^z\.[\w-]+$/, 'compressed and URL safe');
  assert.ok(hash.length < 200, `short enough to share: ${hash.length}`);
  assert.deepEqual(await decodeState('#' + hash), s);
});

test('site: broken or foreign hashes are ignored', async () => {
  assert.equal(await decodeState(''), null);
  assert.equal(await decodeState('#section-2'), null);
  assert.equal(await decodeState('#z.not-really-deflate'), null);
  assert.equal(await decodeState('#j.' + btoa('{"no":"look"}')), null);
});

test('site: snippets use attributes, and a preset file only when needed', () => {
  const simple = state({ charset: 'hard', color: ['#2a1400', '#ffb000'], edges: true, pitch: 0.3 });
  assert.equal(needsPreset(simple.look), false);
  const html = embedSnippet(simple, 'viewer', 'logo.glb');
  assert.match(html, /<script type="module" src="https:\/\/cdn\.jsdelivr\.net\/npm\/@feelgxxd\/textel@[\d.]+\/dist\/textel-viewer\.js"><\/script>/);
  assert.match(html, /<textel-viewer src="logo\.glb" charset="hard" color="#2a1400,#ffb000" edges pitch="0\.3" style="[^"]+"><\/textel-viewer>/);
  assert.doesNotMatch(html, /preset=/);

  const rich = state({ charset: 'hard', light: [1, 0, 0], materials: { Glass: 'carved' } });
  assert.equal(needsPreset(rich.look), true);
  assert.match(embedSnippet(rich, 'viewer', 'logo.glb'), /preset="look\.json"/);
  assert.deepEqual(JSON.parse(presetJSON({ ...rich.look, color: undefined })), { charset: 'hard', light: [1, 0, 0], materials: { Glass: 'carved' } });

  assert.match(embedSnippet(simple, 'player', 'logo.textel.json'), /<textel-player src="logo\.textel\.json" style="[^"]+"><\/textel-player>/);
  // attribute values are escaped
  assert.match(embedSnippet(state({ chars: ' ."#' }), 'viewer', 'a"b.glb'), /src="a&quot;b\.glb" chars=" \.&quot;#"/);
});

test('site: CLI commands run with the real CLI', () => {
  const s = state({ charset: 'hard', color: ['#2a1400', '#ffb000'], edges: 'depth', pitch: 0.3, spin: 0 });
  const preview = cliCommand(s, 'preview', 'logo.glb');
  assert.equal(preview, 'npx @feelgxxd/textel logo.glb --chars hard --color #2a1400,#ffb000 --edges depth --pitch 0.3 --spin 0');
  assert.equal(cliCommand(s, 'render', 'my logo.glb'), 'npx @feelgxxd/textel render "my logo.glb" --chars hard --color #2a1400,#ffb000 --edges depth --pitch 0.3 --spin 0 -o "my logo.textel.json"');
  const folds = state({ edges: 'crease' });
  assert.equal(cliCommand(folds, 'preview', 'a.glb'), 'npx @feelgxxd/textel a.glb --edges crease');
  assert.match(embedSnippet(folds, 'viewer', 'a.glb'), / edges="crease"/);
  const own = state({ color: 'model' });
  assert.equal(cliCommand(own, 'preview', 'a.glb'), 'npx @feelgxxd/textel a.glb --color model');
  assert.match(embedSnippet(own, 'viewer', 'a.glb'), / color="model"/);
  assert.match(cliCommand(state({ light: [0, 1, 0] }), 'preview', 'a.glb'), /--preset look\.json/);

  // the flags the playground writes are flags the CLI accepts: swap the model for an example and run it
  const cli = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url));
  const args = preview.split(' ').slice(3);
  const r = spawnSync(process.execPath, [cli, '--example', 'gem', '--once', '--size', '40x16', ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.trim().length > 0);
});

test('site: light angles convert both ways', () => {
  for (const [az, el] of [[0, 0], [-40, 20], [135, -30], [90, 60]]) {
    assert.deepEqual(anglesFromLight(lightFromAngles(az, el)), [az, el]);
  }
  assert.deepEqual(lightFromAngles(0, 90).map((v) => Math.round(v)), [0, 1, 0]);
});

test('site: every preset gallery entry uses a known charset and valid colors', async () => {
  const { createRenderer } = await import('../src/render.ts');
  const { MeshBuilder } = await import('../src/mesh.ts');
  const b = new MeshBuilder();
  b.triangle(b.vertex(0, 0, 0), b.vertex(1, 0, 0), b.vertex(0, 1, 0), b.material('m'));
  for (const p of PRESETS) assert.doesNotThrow(() => createRenderer(b.build(), p.look), p.name);
});

test('site: snippets load the released version, and the README agrees', async () => {
  const { readFileSync } = await import('node:fs');
  const root = new URL('../', import.meta.url);
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as { version: string };
  assert.equal(VERSION, pkg.version.split('.').slice(0, 2).join('.'), 'VERSION in site/src/state.ts follows package.json');
  const readme = readFileSync(new URL('README.md', root), 'utf8');
  for (const [, v] of readme.matchAll(/@feelgxxd\/textel@([\d.]+)\//g)) assert.equal(v, VERSION, 'CDN links in the README');
});

test('site: a single-file page carries the player and the frames, and nothing closes its script early', () => {
  const frames = JSON.stringify({ textel: 1, meta: { title: 'a </script><b>' }, data: 'AAAA' });
  const player = 'customElements.define("textel-player",class extends HTMLElement{});const s="</script>";';
  const html = standaloneHTML(frames, player, { title: 'logo & co', page: { fg: '#e8e8e8', bg: '#111214' }, ratio: 1.25 });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>logo &amp; co<\/title>/);
  assert.match(html, /background:#111214;color:#e8e8e8/);
  assert.match(html, /width:min\(94vw,1\.25\*94vh\)/);
  const script = html.slice(html.indexOf('<script type="module">') + 22, html.lastIndexOf('</script>'));
  assert.doesNotMatch(script, /<\/script/i, 'the only closing tag is the real one');
  // the escaped data still reads back as the same frames
  const literal = script.slice(script.indexOf('.recording = ') + 13, script.lastIndexOf(';'));
  assert.deepEqual(JSON.parse(literal.replace(/<\\\//g, '</')), JSON.parse(frames));
});
