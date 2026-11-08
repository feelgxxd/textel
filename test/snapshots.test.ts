import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CASES, renderCase, SNAPSHOT_DIR } from './snapshot-cases.ts';

for (const c of CASES) {
  test(`snapshot: ${c.name}`, () => {
    let want: string;
    try {
      want = readFileSync(new URL(`${c.name}.txt`, SNAPSHOT_DIR), 'utf8').replace(/\r\n/g, '\n');
    } catch {
      assert.fail(`missing snapshot ${c.name}.txt; run npm run snapshots`);
    }
    const got = renderCase(c);
    if (got !== want) {
      const g = got.split('\n'), w = want.split('\n');
      const diff = g.flatMap((line, i) => (line === w[i] ? [] : [`row ${i}\n  want |${w[i] ?? ''}|\n  got  |${line}|`]));
      assert.fail(`${c.name} changed in ${diff.length} rows (npm run snapshots if intended):\n${diff.slice(0, 6).join('\n')}`);
    }
  });
}
