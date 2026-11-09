// The docs page, put together at build time from what already exists: the README is the guide, the
// CLI's own help is the CLI reference, the doc comments are the API reference, docs/format.md is the
// format spec. Nothing here is written twice.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULTS } from '../../src/style.ts';
import { apiReference } from './api.ts';
import { escape, markdown } from './markdown.ts';

const root = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const REPO = 'https://github.com/feelgxxd/textel/blob/main/';

/** README sections that belong on the repo page, not in the docs */
const SKIP = ['Roadmap', 'License'];

export function docsPage(): { body: string; toc: string } {
  const toc: string[] = [];
  const heading = (level: number, text: string, id: string) => {
    if (level <= 3) toc.push(`<li class="l${level}"><a href="#${id}">${text.replace(/`/g, '').replace(/</g, '&lt;')}</a></li>`);
  };
  // repo files become links to GitHub, except the ones this page shows itself
  const link = (href: string) => (href === 'docs/format.md' ? '#format' : /^[\w./-]+\.(md|ts|json)$/.test(href) ? REPO + href : href);
  const section = (id: string, title: string) => {
    heading(2, title, id);
    return `<h2 id="${id}" class="part">${escape(title)}</h2>`;
  };
  const out: string[] = [];

  // the guide: every README section after the intro
  const readme = readFileSync(root('README.md'), 'utf8').split(/^(?=## )/m).slice(1).filter((s) => !SKIP.some((k) => s.startsWith(`## ${k}`)));
  out.push(section('guide', 'Guide'));
  out.push(markdown(readme.join('\n'), { link, heading, shift: 1 }));

  // the CLI's own help text for each command
  out.push(section('cli', 'CLI reference'));
  const cli = (...args: string[]) => execFileSync(process.execPath, [root('src/cli/main.ts'), ...args], { encoding: 'utf8' });
  out.push(`<pre><code>${escape(cli('--help'))}</code></pre>`);
  for (const c of ['preview', 'render', 'play', 'list']) {
    heading(3, `textel ${c}`, `cli-${c}`);
    out.push(`<h3 id="cli-${c}"><code>textel ${c}</code></h3><pre><code>${escape(cli('help', c))}</code></pre>`);
  }

  out.push(section('api', 'API reference'));
  out.push('<p>Everything the package exports, read from the code and its doc comments. Style options are what a preset file holds.</p>');
  out.push(apiReference([
    { path: '@feelgxxd/textel', file: root('src/index.ts') },
    { path: '@feelgxxd/textel/sdf', file: root('src/sdf.ts') },
    { path: '@feelgxxd/textel/frames', file: root('src/frames.ts') },
    { path: '@feelgxxd/textel/terminal', file: root('src/terminal.ts') },
    { path: '@feelgxxd/textel/examples', file: root('src/examples.ts') },
    { path: '@feelgxxd/textel/draco', file: root('src/loaders/draco.ts') },
  ], { StyleInput: DEFAULTS }, heading));

  out.push(`<div id="format"></div>`);
  const format = readFileSync(root('docs/format.md'), 'utf8');
  out.push(markdown(format, { link, heading: (l, t, id) => heading(l, l === 2 ? 'Frames format' : t, id), shift: 1 }));

  return { body: out.join('\n'), toc: `<ul>${toc.join('')}</ul>` };
}
