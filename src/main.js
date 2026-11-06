// Composition root: the ONLY module that touches the real clock, filesystem,
// network and child processes. Everything else gets them injected.

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { makeBus } from './bus.js';
import { makeJournal } from './store/journal.js';
import { makeLedger } from './money/ledger.js';
import { hardlineRules, checkPath } from './safety/paths.js';
import { makeConsentBroker } from './safety/consent.js';
import { makeGrantStore } from './safety/grants.js';
import { makeChildTracker } from './safety/children.js';
import { makeUndoStore } from './store/undo.js';
import { makeFsWrite } from './tools/fs-write.js';
import { makeRegistry } from './tools/registry.js';
import { makeFsRead } from './tools/fs-read.js';
import { makeShellExec } from './tools/shell-exec.js';
import { makeClaudeCodeProvider } from './providers/claude-code.js';
import { makeRoster } from './crew/roster.js';
import { makeRunHost } from './runs.js';
import { makeServer } from './http/server.js';
import { apiRoutes } from './routes/api.js';
import { mcpRoutes } from './routes/mcp.js';
import { staticRoutes } from './routes/static.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.MONKEYCRAFT_PORT || 8787);
const home = os.homedir();
const workspace = path.resolve(process.env.MONKEYCRAFT_WORKSPACE || path.join(home, 'MonkeyCraftWorkspace'));
const dataDir = path.join(ROOT, 'data');

const clock = { now: () => Date.now() };
const newId = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
const newToken = () => randomBytes(32).toString('hex');
const killProcessGroup = pid => { try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch {} } };
const readCmdline = async pid => { try { return (await fsp.readFile(`/proc/${pid}/cmdline`, 'utf8')).replace(/\0/g, ' '); } catch { return null; } };
const LIMITS = {
  perRunUsd: Number(process.env.MONKEYCRAFT_MAX_RUN_USD || 2),
  perRunTokens: Number(process.env.MONKEYCRAFT_MAX_RUN_TOKENS || 600_000),   // weighted: cache reads count 1/10
  dailyUsd: Number(process.env.MONKEYCRAFT_DAILY_USD || 25),
  maxConcurrent: 2
};

async function findClaude() {
  if (process.env.MONKEYCRAFT_CLAUDE) return process.env.MONKEYCRAFT_CLAUDE;
  for (const p of [path.join(home, '.local/bin/claude'), '/usr/local/bin/claude', '/usr/bin/claude']) {
    try { await fsp.access(p); return p; } catch {}
  }
  return 'claude';
}

async function main() {
  await fsp.mkdir(workspace, { recursive: true });
  await fsp.mkdir(dataDir, { recursive: true });
  const realWorkspace = await fsp.realpath(workspace);
  const pathEnv = { home, workspace: realWorkspace, dataDir, rules: hardlineRules({ home, dataDir }), realpath: p => fsp.realpath(p) };

  // Leftover child processes from a crash are killed first (after checking their command lines).
  const children = makeChildTracker({ fsp, file: path.join(dataDir, 'children.json'), readCmdline, kill: killProcessGroup, log: m => console.warn(m) });
  const reaped = await children.reapLeftovers();
  if (reaped.length) console.log(`Stopped ${reaped.length} leftover process(es) from the last run: ${reaped.map(c => `${c.kind} ${c.pid}`).join(', ')}`);
  // every child MonkeyCraft starts is tracked until it exits
  const trackedSpawn = kind => (cmd, args, opts) => {
    const child = spawn(cmd, args, opts);
    const match = kind === 'claude' ? (args.join(' ').match(/\/mcp\/run_[A-Za-z0-9_-]+/) || [cmd])[0] : String(args[args.length - 1]).slice(0, 200);
    children.add(child.pid, kind, match);
    child.on('close', () => children.remove(child.pid));
    child.on('error', () => children.remove(child.pid));
    return child;
  };

  const grants = makeGrantStore({ fsp, file: path.join(dataDir, 'grants.json'), clock });
  const g = await grants.load();
  if (!g.ok) console.warn(`Remembered answers couldn't be read (${g.error}); starting with none.`);
  const undo = makeUndoStore({ fsp, dir: path.join(dataDir, 'undo'), newId, clock });
  const guardPath = async p => { const c = await checkPath(p, pathEnv); return c.error || c.hardline || null; };

  const journal = makeJournal({ fsp, dir: path.join(dataDir, 'runs') });
  await journal.init();
  const ledger = makeLedger({ fsp, file: path.join(dataDir, 'ledger.ndjson') });
  const bus = makeBus({ clock, journal, log: m => console.warn(m) });
  const consent = makeConsentBroker({ newId, grants, log: m => console.warn(m) });
  const registry = makeRegistry([
    makeFsRead({ fsp, pathEnv }),
    makeFsWrite({ fsp, pathEnv, undo }),
    makeShellExec({ spawn: trackedSpawn('shell'), pathEnv, baseEnv: process.env, killProcessGroup })
  ]);
  const roster = makeRoster({ workspace: realWorkspace });
  const claudePath = await findClaude();
  const providers = { 'claude-code': makeClaudeCodeProvider({ spawn: trackedSpawn('claude'), claudePath, baseEnv: process.env, killProcessGroup, cwd: realWorkspace }) };
  const runs = makeRunHost({
    bus, providers, registry, consent, ledger, roster, journal, clock, newId, newToken,
    mcpUrl: runId => `http://127.0.0.1:${PORT}/mcp/${runId}`,
    limits: LIMITS, undo, guardPath
  });
  await runs.init();

  const recovered = await runs.recover();
  await journal.flush();
  if (recovered.length) console.log(`Closed ${recovered.length} job(s) interrupted by the last shutdown.`);

  const server = makeServer({
    port: PORT,
    routes: [...staticRoutes({ fsp, uiDir: path.join(ROOT, 'ui') }), ...apiRoutes({ bus, runs, consent, grants, roster, journal, ledger, clock, limits: LIMITS }), ...mcpRoutes({ runs })]
  });
  await server.listen();
  console.log(`MonkeyCraft is running: http://127.0.0.1:${PORT}/`);
  console.log(`Workspace: ${realWorkspace}  ·  Claude Code: ${claudePath}`);

  let stopping = false;
  const shutdown = async sig => {
    if (stopping) return; stopping = true;
    console.log(`\n${sig}: stopping all jobs…`);
    runs.halt('system');
    await new Promise(r => setTimeout(r, 500));
    await journal.flush();
    await children.flush(); await grants.flush();
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(e => { console.error('MonkeyCraft failed to start:', e.message); process.exit(1); });
