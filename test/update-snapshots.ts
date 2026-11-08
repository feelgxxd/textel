// Regenerates the golden frames: npm run snapshots
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CASES, renderCase, SNAPSHOT_DIR } from './snapshot-cases.ts';

mkdirSync(SNAPSHOT_DIR, { recursive: true });
let changed = 0;
for (const c of CASES) {
  const file = new URL(`${c.name}.txt`, SNAPSHOT_DIR), text = renderCase(c);
  let old = '';
  try { old = readFileSync(file, 'utf8').replace(/\r\n/g, '\n'); } catch { /* new */ }
  if (old === text) continue;
  writeFileSync(file, text);
  changed++;
  console.log(`${old ? 'updated' : 'created'} ${c.name}.txt`);
}
console.log(changed ? `${changed} snapshot(s) written` : 'snapshots are up to date');
