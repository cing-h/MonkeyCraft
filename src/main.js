// Composition root: the ONLY module that touches the real clock, filesystem,
// network and child processes. Everything else gets them injected.

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
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
import { makeFsEdit } from './tools/fs-edit.js';
import { makeFsMove } from './tools/fs-move.js';
import { makeVerifyRun } from './tools/verify-run.js';
import { makeWebFetch } from './tools/web-fetch.js';
import { makeGoogleAuth } from './google/auth.js';
import { makeGoogleApi } from './google/api.js';
import { makeDrive } from './google/drive.js';
import { makeDriveTools } from './tools/google-drive.js';
import { makeDocs } from './google/docs.js';
import { makeDocsTools } from './tools/google-docs.js';
import { makeSheets } from './google/sheets.js';
import { makeSheetsTools } from './tools/google-sheets.js';
import { makeSlides } from './google/slides.js';
import { makeSlidesTools } from './tools/google-slides.js';
import { googleRoutes } from './routes/google.js';
import { makeCrewTools } from './crew/orchestrate.js';
import { makeCouncil, makeCouncilTools } from './crew/council.js';
import { councilRoutes } from './routes/council.js';
import { makeAskClaudeTools } from './crew/ask-claude.js';
import { makeMailbox } from './link/mailbox.js';
import { makeLinkSession } from './link/session.js';
import { linkRoutes } from './routes/link.js';
import dns from 'node:dns/promises';
import { makeRegistry } from './tools/registry.js';
import { makeFsRead } from './tools/fs-read.js';
import { makeShellExec } from './tools/shell-exec.js';
import { makeClaudeCodeProvider } from './providers/claude-code.js';
import { makeAnthropicProvider } from './providers/anthropic.js';
import { makeSettingsStore, LIMIT_RANGES, brainPathProblem } from './settings.js';
import { settingsRoutes } from './routes/settings.js';
import { makeRoster } from './crew/roster.js';
import { makeRunHost } from './runs.js';
import { makeServer } from './http/server.js';
import { apiRoutes } from './routes/api.js';
import { mcpRoutes } from './routes/mcp.js';
import { staticRoutes } from './routes/static.js';
import { makeBrain } from './brain/vault.js';
import { brainRoutes } from './routes/brain.js';
import { makeRecall } from './brain/recall.js';
import { makeBrainTools } from './tools/brain.js';

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
  familyUsd: Number(process.env.MONKEYCRAFT_MAX_FAMILY_USD || 5),            // a lead and all its workers together
  familyTokens: Number(process.env.MONKEYCRAFT_MAX_FAMILY_TOKENS || 2_000_000),
  maxConcurrent: 2,   // top-level jobs at once
  maxWorkers: 2       // crew members working for leads at once
};

async function findClaude() {
  if (process.env.MONKEYCRAFT_CLAUDE) return process.env.MONKEYCRAFT_CLAUDE;
  for (const p of [path.join(home, '.local/bin/claude'), '/usr/local/bin/claude', '/usr/bin/claude']) {
    try { await fsp.access(p); return p; } catch {}
  }
  return 'claude';
}

// The Brain's default home: C:\Users\<you>\MonkeyCraftBrain on Windows (outside
// OneDrive, so it stays on this computer), else ~/MonkeyCraftBrain.
async function defaultBrainDir() {
  if (process.env.MONKEYCRAFT_BRAIN) return path.resolve(process.env.MONKEYCRAFT_BRAIN);
  const run = (cmd, args) => new Promise(ok => execFile(cmd, args, { timeout: 4000 }, (e, out) => ok(e ? '' : String(out).replace(/\r/g, '').trim())));
  const win = await run('/mnt/c/Windows/System32/cmd.exe', ['/d', '/c', 'echo %USERPROFILE%']);
  if (/^[A-Za-z]:\\Users\\[^%\\]+$/.test(win)) { const unix = await run('wslpath', ['-u', win]); if (unix.startsWith('/mnt/')) return path.join(unix, 'MonkeyCraftBrain'); }
  return path.join(home, 'MonkeyCraftBrain');
}
// What a shell command must never mention: the Brain in its WSL and Windows spellings, and its folder name.
function brainNames(dir) {
  const out = [dir], m = dir.match(/^\/mnt\/([a-z])\/(.*)$/i);
  if (m) { out.push(`${m[1]}:\\${m[2].replace(/\//g, '\\')}`, `${m[1]}:/${m[2]}`); }
  const base = path.basename(dir);
  if (base.length >= 10 && !/\s/.test(base)) out.push(base);
  return out;
}

async function main() {
  await fsp.mkdir(workspace, { recursive: true });
  await fsp.mkdir(dataDir, { recursive: true });
  const realWorkspace = await fsp.realpath(workspace);
  const roster = makeRoster({ workspace: realWorkspace });
  // settings: env vars are the defaults, saved choices override them
  const settings = makeSettingsStore({ fsp, file: path.join(dataDir, 'settings.json'), crewIds: roster.ids(), workspace: realWorkspace, dataDir });
  const sl = await settings.load();
  if (!sl.ok) console.warn(`Settings couldn't be read (${sl.error}); using the defaults.`);
  // the Brain: the village's own vault, hardlined for every ordinary tool
  let brainDir = settings.get().brain?.path;
  if (!brainDir) {   // first run: pick the default once and remember it, so the Brain never moves by itself
    brainDir = await defaultBrainDir();
    const why = brainPathProblem(brainDir, { workspace: realWorkspace, dataDir });
    if (why) { console.warn(`The default Brain folder ${brainDir} can't be used (${why}); using ~/MonkeyCraftBrain.`); brainDir = path.join(home, 'MonkeyCraftBrain'); }
    await settings.save({ ...settings.get(), brain: { path: brainDir } });
  }
  const brain = makeBrain({ fsp, root: brainDir, clock, newId });
  const pathEnv = { home, workspace: realWorkspace, dataDir, brainNames: brainNames(brainDir), rules: hardlineRules({ home, dataDir, brainDir }), realpath: p => fsp.realpath(p) };
  const bi = await brain.init();
  if (!bi.ok) console.warn(`The Brain couldn't be opened at ${brainDir} (${bi.error}); the crew will work without it.`);
  else if (bi.created) console.log(`Made the Brain at ${brainDir}. Open that folder as a vault in Obsidian to read it.`);

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
  // the link with an outside Claude Code session: its token (made once, owner-only) and the Chief's mailbox
  const linkTokenFile = path.join(dataDir, 'link-token');
  let linkToken = '';
  try { linkToken = (await fsp.readFile(linkTokenFile, 'utf8')).trim(); } catch {}
  if (!/^[0-9a-f]{64}$/.test(linkToken)) { linkToken = newToken(); await fsp.writeFile(linkTokenFile, linkToken + '\n', { mode: 0o600 }); }
  const mailbox = makeMailbox({ fsp, file: path.join(dataDir, 'mailbox.json'), clock, newId, log: m => console.warn(m) });
  const mb = await mailbox.load();
  if (!mb.ok) console.warn(`The Chief's mailbox couldn't be read (${mb.error}); starting empty.`);
  const undo = makeUndoStore({ fsp, dir: path.join(dataDir, 'undo'), newId, clock });
  const guardPath = async p => { const c = await checkPath(p, pathEnv); return c.error || c.hardline || null; };

  const journal = makeJournal({ fsp, dir: path.join(dataDir, 'runs') });
  await journal.init();
  const ledger = makeLedger({ fsp, file: path.join(dataDir, 'ledger.ndjson') });
  const bus = makeBus({ clock, journal, log: m => console.warn(m) });
  const consent = makeConsentBroker({ newId, grants, log: m => console.warn(m) });
  // Google (the Clerk): sign-in kept in data/google/, which the tools can never read
  const googleAuth = makeGoogleAuth({ fsp, dir: path.join(dataDir, 'google'), fetchImpl: fetch, clock, randomBytes, redirectUri: `http://127.0.0.1:${PORT}/api/google/callback` });
  const ga = await googleAuth.load();
  if (!ga.ok) console.warn(`The Google sign-in couldn't be read (${ga.error}); Google is not connected.`);
  const googleApi = makeGoogleApi({ auth: googleAuth, fetchImpl: fetch });
  const drive = makeDrive({ api: googleApi }), docs = makeDocs({ api: googleApi }), sheets = makeSheets({ api: googleApi });
  const slides = makeSlides({ api: googleApi, newObjectId: () => `mc${randomBytes(9).toString('hex')}` });
  const shell = makeShellExec({ spawn: trackedSpawn('shell'), pathEnv, baseEnv: process.env, killProcessGroup });
  let council = null;   // made once the run host exists (below); the council tools look it up when they run
  const registry = makeRegistry([
    makeFsRead({ fsp, pathEnv }),
    makeFsWrite({ fsp, pathEnv, undo }),
    makeFsEdit({ fsp, pathEnv, undo }),
    makeFsMove({ fsp, pathEnv, undo }),
    shell,
    makeVerifyRun({ shell }),
    makeWebFetch({ fetchImpl: fetch, lookup: host => dns.lookup(host, { all: true }) }),
    ...makeDriveTools({ auth: googleAuth, drive, undo }),
    ...makeDocsTools({ auth: googleAuth, drive, docs, undo, clock }),
    ...makeSheetsTools({ auth: googleAuth, drive, sheets, undo, clock }),
    ...makeSlidesTools({ auth: googleAuth, drive, slides, undo, clock }),
    ...makeCrewTools({ roster }),
    ...makeAskClaudeTools({ mailbox }),
    ...makeCouncilTools({ roster, clock, councils: { get: id => council?.councils.get(id) } }),
    ...makeBrainTools({ brain, roster })
  ]);
  const claudePath = await findClaude();
  const ENV_LIMITS = { ...LIMITS };
  const applySettings = s => { roster.configure(s.crew); for (const k of Object.keys(LIMIT_RANGES)) LIMITS[k] = s.limits[k] ?? ENV_LIMITS[k]; };
  applySettings(settings.get());
  const apiKey = process.env.MONKEYCRAFT_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '';
  const providers = { 'anthropic-api': makeAnthropicProvider({ apiKey }), 'claude-code': makeClaudeCodeProvider({ spawn: trackedSpawn('claude'), claudePath, baseEnv: process.env, killProcessGroup, cwd: realWorkspace }) };
  const runs = makeRunHost({
    bus, providers, registry, consent, ledger, roster, journal, clock, newId, newToken,
    mcpUrl: runId => `http://127.0.0.1:${PORT}/mcp/${runId}`,
    limits: LIMITS, undo, guardPath,
    remoteUndo: r => googleAuth.status().connected ? drive.revertChange(r) : "skipped: Google isn't connected",
    onRunEnd: runId => mailbox.askerEnded(runId),
    recall: makeRecall({ brain })
  });
  await runs.init();
  setInterval(() => runs.checkLiveness(), 15_000).unref();
  council = makeCouncil({ fsp, file: path.join(dataDir, 'council.json'), clock, runs, roster, ledger, journal, log: m => console.warn(m) });
  await council.load();
  setInterval(() => council.tick().catch(e => console.warn('[council]', e.message)), 60_000).unref();   // the daily council

  const link = makeLinkSession({ fsp, file: path.join(dataDir, 'link-jobs.json'), runs, roster, mailbox, clock, log: m => console.warn(m) });
  await link.load();

  const recovered = await runs.recover();
  await journal.flush();
  if (recovered.length) console.log(`Closed ${recovered.length} job(s) interrupted by the last shutdown.`);
  // the Job log survives restarts: the newest jobs are replayed from the journal to every new screen
  const history = await journal.history(30);
  bus.seed(history);

  const server = makeServer({
    port: PORT,
    routes: [...staticRoutes({ fsp, uiDir: path.join(ROOT, 'ui') }), ...apiRoutes({ bus, runs, consent, grants, roster, journal, ledger, clock, limits: LIMITS }), ...settingsRoutes({ store: settings, roster, providers, limits: LIMITS, apply: applySettings, brain, workspace: realWorkspace, dataDir }), ...brainRoutes({ brain }), ...mcpRoutes({ runs }), ...linkRoutes({ session: link, mailbox, token: linkToken }), ...councilRoutes({ council }), ...googleRoutes({ auth: googleAuth })]
  });
  await server.listen();
  console.log(`MonkeyCraft is running: http://127.0.0.1:${PORT}/`);
  console.log(`Workspace: ${realWorkspace}  ·  Claude Code: ${claudePath}  ·  Anthropic API: ${apiKey ? 'key found' : 'no key'}  ·  Google: ${googleAuth.status().connected ? 'connected' : 'not connected'}  ·  Brain: ${brain.status().ready ? brainDir : 'not available'}`);

  let stopping = false;
  const shutdown = async sig => {
    if (stopping) return; stopping = true;
    console.log(`\n${sig}: stopping all jobs…`);
    runs.halt('system');
    await new Promise(r => setTimeout(r, 500));
    await journal.flush();
    await children.flush(); await grants.flush(); await mailbox.flush(); await link.flush();
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(e => { console.error('MonkeyCraft failed to start:', e.message); process.exit(1); });
