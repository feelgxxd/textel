// The API reference, read from the library's own exports and doc comments with the TypeScript
// compiler, so it cannot drift from the code.
import ts from 'typescript';
import { escape, inline, slug } from './markdown.ts';

export interface Entry {
  /** the import path people write */
  path: string;
  file: string;
}

interface Item {
  name: string;
  kind: string;
  /** the declaration without its body */
  signature: string;
  doc: string;
  /** interface fields and class members */
  members: { name: string; type: string; doc: string }[];
  file: string;
}

// sections, by the file a name is declared in
const GROUPS: [RegExp, string][] = [
  [/render\.ts$/, 'Rendering'],
  [/output\.ts$/, 'Output'],
  [/style\.ts$/, 'Style'],
  [/loaders[\\/]/, 'Loading models'],
  [/(mesh|simplify)\.ts$/, 'Meshes'],
  [/(frames|format|svg)\.ts$/, 'Recordings'],
];

const clean = (s: string) => s.replace(/^export\s+(default\s+)?/, '').replace(/\s+/g, ' ').trim();

function items(program: ts.Program, file: string): Item[] {
  const checker = program.getTypeChecker(), sf = program.getSourceFile(file);
  const mod = sf && checker.getSymbolAtLocation(sf);
  if (!mod) throw new Error(`no module for ${file}`);
  const doc = (s: ts.Symbol | undefined) => (s ? ts.displayPartsToString(s.getDocumentationComment(checker)) : '');
  const out: Item[] = [];
  for (const exported of checker.getExportsOfModule(mod)) {
    const sym = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    const d = sym.declarations?.[0];
    if (!d) continue;
    const src = d.getSourceFile(), text = (n: ts.Node) => clean(n.getText(src));
    const item: Item = { name: exported.name, kind: '', signature: '', doc: doc(sym), members: [], file: src.fileName };
    if (ts.isFunctionDeclaration(d)) {
      item.kind = 'function';
      // every overload, without the body
      item.signature = (sym.declarations ?? []).filter(ts.isFunctionDeclaration).map((f) => clean(src.text.slice(f.getStart(src), f.body ? f.body.getStart(src) : f.end))).join('\n');
    } else if (ts.isVariableDeclaration(d)) {
      item.kind = 'const';
      item.signature = `const ${exported.name}: ${checker.typeToString(checker.getTypeOfSymbolAtLocation(sym, d), undefined, ts.TypeFormatFlags.NoTruncation)}`;
    } else if (ts.isTypeAliasDeclaration(d)) {
      item.kind = 'type';
      item.signature = text(d);
    } else if (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) {
      const isClass = ts.isClassDeclaration(d);
      item.kind = isClass ? 'class' : 'interface';
      item.signature = `${isClass ? 'class' : 'interface'} ${exported.name}${d.typeParameters ? `<${d.typeParameters.map((p) => p.getText(src)).join(', ')}>` : ''}${d.heritageClauses ? ' ' + d.heritageClauses.map((h) => h.getText(src)).join(' ') : ''}`;
      for (const m of d.members) {
        const name = m.name?.getText(src);
        // private parts stay out
        if (!name || name.startsWith('#') || ts.getCombinedModifierFlags(m as ts.Declaration) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) continue;
        let type = '';
        if (ts.isPropertySignature(m) || ts.isPropertyDeclaration(m)) type = (m.questionToken ? '?: ' : ': ') + (m.type ? clean(m.type.getText(src)) : '');
        else if (ts.isMethodSignature(m) || ts.isMethodDeclaration(m) || ts.isConstructorDeclaration(m)) {
          const s = src.text.slice(m.getStart(src), ts.isMethodDeclaration(m) || ts.isConstructorDeclaration(m) ? (m.body?.getStart(src) ?? m.end) : m.end);
          type = clean(s.replace(/^(async\s+)?[\w$]+\??/, '').replace(/^constructor/, '')).replace(/;$/, '');
        } else if (ts.isGetAccessor(m)) type = ': ' + (m.type ? clean(m.type.getText(src)) : '');
        else continue;
        if (item.members.some((x) => x.name === name)) continue;
        item.members.push({ name: ts.isConstructorDeclaration(m) ? 'constructor' : name, type, doc: doc(checker.getSymbolAtLocation(m.name ?? m)) });
      }
    } else continue;
    out.push(item);
  }
  return out;
}

const group = (file: string) => GROUPS.find(([re]) => re.test(file))?.[1] ?? 'Other';

/**
 * The reference as HTML: one section per entry point. Names already shown under an earlier entry
 * are not repeated. `defaults` adds a Default column to the interfaces named in it.
 */
export function apiReference(entries: Entry[], defaults: Record<string, Record<string, unknown>> = {}, toc?: (level: number, text: string, id: string) => void): string {
  const program = ts.createProgram(entries.map((e) => e.file), {
    allowImportingTsExtensions: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true, types: ['node'],
  });
  const seen = new Set<string>(), html: string[] = [];
  for (const entry of entries) {
    const list = items(program, entry.file).filter((it) => !seen.has(it.name));
    if (!list.length) continue;
    list.forEach((it) => seen.add(it.name));
    const id = 'api-' + slug(entry.path);
    toc?.(3, entry.path, id);
    html.push(`<h3 id="${id}"><code>${escape(entry.path)}</code></h3>`);
    // the main entry is long: split it into groups
    const groups = new Map<string, Item[]>();
    for (const it of list) {
      const g = entries.indexOf(entry) === 0 ? group(it.file) : '';
      groups.set(g, [...(groups.get(g) ?? []), it]);
    }
    for (const [g, its] of groups) {
      if (g) html.push(`<h4 class="group">${escape(g)}</h4>`);
      for (const it of its) {
        const def = defaults[it.name];
        html.push(`<section class="api" id="${slug(entry.path)}-${it.name}">`);
        html.push(`<h5><code>${escape(it.name)}</code> <span class="kind">${it.kind}</span></h5>`);
        html.push(`<pre><code>${escape(it.signature)}</code></pre>`);
        if (it.doc) html.push(it.doc.split(/\n\s*\n/).map((p) => `<p>${inline(p.replace(/\n/g, ' '))}</p>`).join(''));
        if (it.members.length) {
          html.push(`<div class="table"><table><thead><tr><th>member</th><th>type</th>${def ? '<th>default</th>' : ''}<th></th></tr></thead><tbody>`);
          for (const m of it.members) {
            const d = def && m.name in def ? JSON.stringify(def[m.name]) : '';
            html.push(`<tr><td><code>${escape(m.name)}</code></td><td><code>${escape(m.type.replace(/^\??: /, ''))}</code>${m.type.startsWith('?') ? ' <span class="opt">optional</span>' : ''}</td>${def ? `<td>${d ? `<code>${escape(d)}</code>` : ''}</td>` : ''}<td>${inline(m.doc.replace(/\n/g, ' '))}</td></tr>`);
          }
          html.push('</tbody></table></div>');
        }
        html.push('</section>');
      }
    }
  }
  return html.join('\n');
}
