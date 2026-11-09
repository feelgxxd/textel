// The header and footer every page of the site shares, in the visual language of the author's other
// sites: the cassette stripe, the skull mark, numbered navigation. Put in at build time, so each page
// carries the same markup without a script.

const PORTFOLIO = 'https://berkbeken.xo.je';
const REPO = 'https://github.com/feelgxxd/textel';
const NPM = 'https://www.npmjs.com/package/@feelgxxd/textel';

export type Page = 'playground' | 'docs';

/** `root` is the path from the page to the site root: './' for the playground, '../' for the docs */
export function header(page: Page, root: string): string {
  const items: [string, string, Page | null][] = [
    ['playground', root, 'playground'],
    ['docs', `${root}docs/`, 'docs'],
    ['github ↗', REPO, null],
    ['npm ↗', NPM, null],
  ];
  return `<header class="hdr">
  <div class="stripes"></div>
  <div class="hdr__in">
    <a class="logo" href="${root}" aria-label="textel, the playground">
      <span class="logo__mark" aria-hidden="true"></span>
      <span class="logo__txt"><b>TEXTEL</b><small>// by feelgxxd</small></span>
    </a>
    <nav class="nav" aria-label="main"><ol>${items
      .map(([label, href, p], i) => `<li><a href="${href}"${p === page ? ' aria-current="page"' : ''}><span class="n">0${i + 1}</span>${label}</a></li>`)
      .join('')}</ol></nav>
  </div>
</header>`;
}

export function footer(version: string): string {
  return `<footer class="ftr">
  <div class="stripes"></div>
  <div class="ftr__in">
    <span>© ${new Date().getFullYear()} <a href="${PORTFOLIO}">Berk Beken</a></span>
    <span class="ftr__sep">textel ${version} · MIT</span>
    <a class="ftr__home" href="${PORTFOLIO}">more from feelgxxd ↗</a>
  </div>
</footer>`;
}
