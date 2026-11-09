// A small Markdown to HTML converter for the docs page, run at build time. It covers what the README
// and docs/format.md use: headings, paragraphs, fenced code, tables, one level of lists, inline code,
// bold, italics and links. Raw HTML lines pass through.

export const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export interface MarkdownOptions {
  /** rewrites a link target, e.g. a repo file to its page or section */
  link?: (href: string) => string;
  /** called for each heading, for a table of contents */
  heading?: (level: number, text: string, id: string) => void;
  /** added to every heading level, so a document's # can sit under the page's own title */
  shift?: number;
}

export function inline(s: string, opts: MarkdownOptions = {}): string {
  // code spans first, so nothing inside them is touched
  const codes: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_, c: string) => `\u0000${codes.push(`<code>${escape(c)}</code>`) - 1}\u0000`);
  s = escape(s)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t: string, h: string) => `<a href="${escape(opts.link ? opts.link(h) : h)}">${t}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codes[+i]);
}

export function markdown(text: string, opts: MarkdownOptions = {}): string {
  const lines = text.replace(/\r/g, '').split('\n'), out: string[] = [];
  const shift = opts.shift ?? 0;
  let i = 0;
  const para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '), opts)}</p>`);
    para.length = 0;
  };
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^```(\w*)/.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
      i++;
      out.push(`<pre${fence[1] ? ` data-lang="${fence[1]}"` : ''}><code>${escape(code.join('\n'))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const level = Math.min(6, h[1].length + shift), id = slug(h[2]);
      opts.heading?.(level, h[2], id);
      out.push(`<h${level} id="${id}">${inline(h[2], opts)}</h${level}>`);
      i++;
      continue;
    }
    if (line.startsWith('|')) {
      flush();
      const rows: string[][] = [];
      for (; i < lines.length && lines[i].startsWith('|'); i++) {
        // split on pipes that are not inside a code span
        const cells: string[] = [];
        let cur = '', code = false;
        for (const ch of lines[i].trim().slice(1, -1)) {
          if (ch === '`') code = !code;
          if (ch === '|' && !code) { cells.push(cur.trim()); cur = ''; } else cur += ch;
        }
        cells.push(cur.trim());
        rows.push(cells);
      }
      const [head, , ...body] = rows;
      out.push(`<div class="table"><table><thead><tr>${head.map((c) => `<th>${inline(c, opts)}</th>`).join('')}</tr></thead><tbody>${body
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c, opts)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table></div>`);
      continue;
    }
    const item = /^(-|\d+\.)\s+(.*)$/.exec(line);
    if (item) {
      flush();
      const ordered = item[1] !== '-', items: string[] = [];
      while (i < lines.length) {
        const m = /^(-|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (!m || (m[1] !== '-') !== ordered) break;
        let body = m[2];
        // continuation lines are indented
        for (i++; i < lines.length && /^\s{2,}\S/.test(lines[i]); i++) body += ' ' + lines[i].trim();
        items.push(`<li>${inline(body, opts)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    if (/^\s*<\/?[a-z]/i.test(line)) { flush(); out.push(line); i++; continue; }
    if (!line.trim()) { flush(); i++; continue; }
    para.push(line.trim());
    i++;
  }
  flush();
  return out.join('\n');
}
