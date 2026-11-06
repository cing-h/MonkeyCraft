// Registers MonkeyCraft with Claude Code (user scope), so any Claude Code
// session on this computer can give the crew jobs and read the Chief's mailbox.
// Usage: node scripts/link-setup.js        (start MonkeyCraft once first, to make the token)
//        node scripts/link-setup.js --remove

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.MONKEYCRAFT_PORT || 8787);
const claude = process.env.MONKEYCRAFT_CLAUDE || 'claude';
const run = args => { try { execFileSync(claude, args, { stdio: 'inherit' }); return true; } catch { return false; } };

run(['mcp', 'remove', '--scope', 'user', 'monkeycraft']);
if (process.argv.includes('--remove')) { console.log('MonkeyCraft is no longer linked to Claude Code.'); process.exit(0); }
let token;
try { token = fs.readFileSync(path.join(ROOT, 'data', 'link-token'), 'utf8').trim(); }
catch { console.error('No link token yet: start MonkeyCraft once (npm start), then run this again.'); process.exit(1); }
const ok = run(['mcp', 'add', '--scope', 'user', '--transport', 'http', 'monkeycraft', `http://127.0.0.1:${PORT}/link/mcp`, '--header', `Authorization: Bearer ${token}`]);
console.log(ok ? 'Linked. Restart Claude Code sessions to see the MonkeyCraft tools.' : 'Linking failed.');
process.exit(ok ? 0 : 1);
