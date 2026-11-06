// Syntax gate: `node --check` every .js file under src/, test/, scripts/ and ui/.
// No dependencies, so it works before anything is installed.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['src', 'test', 'scripts', 'ui'];
const files = [];
const walk = dir => {
  let entries; try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p);
  }
};
roots.forEach(walk);
let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { bad++; process.stderr.write(`✗ ${f}\n${r.stderr}\n`); }
}
console.log(`${files.length - bad}/${files.length} files pass the syntax check`);
process.exit(bad ? 1 : 0);
