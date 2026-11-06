// Watches the Chief's mailbox for the user's Claude Code session.
// Prints one line per new request, then keeps watching, so a Claude Code
// background watcher (Monitor) wakes the session when the Chief asks something.
// Usage: node scripts/mailbox-watch.js   (MonkeyCraft must be running)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.MONKEYCRAFT_PORT || 8787);
const token = fs.readFileSync(path.join(ROOT, 'data', 'link-token'), 'utf8').trim();
const seen = new Set();
const sleep = ms => new Promise(r => setTimeout(r, ms));
let down = false;

for (;;) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/link/mail/wait?seconds=60`, { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (down) { console.log('MonkeyCraft is reachable again.'); down = false; }
    const { waiting } = await r.json();
    for (const i of waiting) if (!seen.has(i.id)) {
      seen.add(i.id);
      console.log(`CHIEF MAILBOX: new request ${i.id}${i.untrusted ? ' [UNTRUSTED]' : ''}: ${i.preview.replace(/\s+/g, ' ')}`);
    }
    if (waiting.length && waiting.every(i => seen.has(i.id))) await sleep(15_000);   // nothing new: don't spin on old requests
  } catch (e) {
    if (!down) { console.log(`MonkeyCraft isn't reachable (${e.message}); retrying.`); down = true; }
    await sleep(10_000);
  }
}
