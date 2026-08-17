// Syntax-check every JS module in the project (node --check per file).
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['js', 'tests', 'tools'];
const files = ['server.js'];
function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|mjs)$/.test(e)) files.push(p);
  }
}
for (const r of roots) walk(r);

let failed = 0;
for (const f of files) {
  const res = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (res.status !== 0) {
    failed++;
    console.error(`FAIL ${f}\n${res.stderr}`);
  }
}
console.log(`${files.length - failed}/${files.length} files syntax-ok`);
process.exit(failed ? 1 : 0);
