// The docs page is made from the README, the CLI help and the doc comments: check that it holds
// together, so a new export without a comment or a broken link shows up here, not on the site.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inline, markdown } from '../site/build/markdown.ts';
import { docsPage } from '../site/build/docs.ts';

test('markdown: the parts the docs use', () => {
  const html = markdown('# Title\n\nSome `a|b` and **bold** with [a link](x.md).\n\n- one\n  more\n- two\n\n| a | b |\n|---|---|\n| `x|y` | 2 |\n\n```ts\nconst a = 1 < 2;\n```\n', { link: (h) => 'L:' + h, shift: 1 });
  assert.match(html, /<h2 id="title">Title<\/h2>/);
  assert.match(html, /<code>a\|b<\/code> and <strong>bold<\/strong> with <a href="L:x.md">a link<\/a>/);
  assert.match(html, /<ul><li>one more<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<td><code>x\|y<\/code><\/td><td>2<\/td>/, 'a pipe inside code does not split the cell');
  assert.match(html, /<pre data-lang="ts"><code>const a = 1 &lt; 2;<\/code><\/pre>/);
  assert.equal(inline('<b> & `<i>`'), '&lt;b&gt; &amp; <code>&lt;i&gt;</code>');
});

test('docs: every export has a description, every id is unique, every link lands', () => {
  const { body, toc } = docsPage();
  for (const part of ['id="guide"', 'id="cli"', 'id="api"', 'id="format"', 'id="cli-render"', 'id="feelgxxd-textel-createRenderer"', 'id="presets"']) assert.ok(body.includes(part), part);

  const undocumented = [...body.matchAll(/<section class="api" id="([^"]+)">([\s\S]*?)<\/section>/g)].filter((m) => !/<\/pre>\s*<p>/.test(m[2])).map((m) => m[1]);
  assert.deepEqual(undocumented, [], 'exports without a doc comment');

  const ids = [...body.matchAll(/ id="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(ids.every(Boolean), 'no empty ids');
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], 'no repeated ids');
  const missing = [...(body + toc).matchAll(/href="#([^"]+)"/g)].map((m) => m[1]).filter((id) => !ids.includes(id));
  assert.deepEqual(missing, [], 'links to missing sections');
  assert.doesNotMatch(body, /href="(?!https?:|#)/, 'only absolute or in-page links');
});
