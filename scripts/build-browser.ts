// Bundles the browser entry points into single minified files: npm run build
// and checks them against their size budgets (min+gzip): npm run size
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const ENTRIES = [
  { in: 'src/browser/player.ts', out: 'dist/textel-player.js', budget: 5 * 1024 },
  { in: 'src/browser/viewer.ts', out: 'dist/textel-viewer.js', budget: 14 * 1024 },
];

const checkOnly = process.argv.includes('--check');
let over = false;
for (const e of ENTRIES) {
  if (!checkOnly) {
    await build({
      entryPoints: [e.in],
      outfile: e.out,
      bundle: true,
      format: 'esm',
      minify: true,
      target: 'es2022',
      legalComments: 'none',
      // the format module has no side effects; lets unused encoders drop out
      treeShaking: true,
    });
  }
  const code = readFileSync(e.out);
  const gz = gzipSync(code, { level: 9 }).length;
  const ok = gz <= e.budget;
  over ||= !ok;
  console.log(`${e.out}: ${(code.length / 1024).toFixed(1)} KB min, ${(gz / 1024).toFixed(2)} KB min+gzip (budget ${(e.budget / 1024).toFixed(0)} KB) ${ok ? 'ok' : 'OVER BUDGET'}`);
}
if (over) process.exit(1);
