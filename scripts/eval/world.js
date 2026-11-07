// One throwaway MonkeyCraft for one test run: its own sandbox workspace, data
// folder and (Brain on) its own copy of the Brain snapshot. The real Brain,
// ledger and Job log are never touched. Everything else (the crew, the model,
// the prompts, the safety pipeline) is the app's own code, so the only
// difference between the two sides is the Brain.

import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { makeBus } from '../../src/bus.js';
import { makeJournal } from '../../src/store/journal.js';
import { makeLedger } from '../../src/money/ledger.js';
import { hardlineRules } from '../../src/safety/paths.js';
import { makeUndoStore } from '../../src/store/undo.js';
import { makeFsRead } from '../../src/tools/fs-read.js';
import { makeFsWrite } from '../../src/tools/fs-write.js';
import { makeFsEdit } from '../../src/tools/fs-edit.js';
import { makeFsMove } from '../../src/tools/fs-move.js';
import { makeShellExec } from '../../src/tools/shell-exec.js';
import { makeVerifyRun } from '../../src/tools/verify-run.js';
import { makeWebFetch } from '../../src/tools/web-fetch.js';
import { makeCrewTools } from '../../src/crew/orchestrate.js';
import { makeRoster } from '../../src/crew/roster.js';
import { makeRegistry } from '../../src/tools/registry.js';
import { makeRunHost } from '../../src/runs.js';
import { makeClaudeCodeProvider } from '../../src/providers/claude-code.js';
import { makeBrain } from '../../src/brain/vault.js';
import { makeRecall } from '../../src/brain/recall.js';
import { makeBrainTools } from '../../src/tools/brain.js';
import dns from 'node:dns/promises';
import { makeSandboxConsent } from './policy.js';

const BRAIN_RULE = /\n- The Brain is the village's shared memory\.[^\n]*/;
const killGroup = pid => { try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch {} } };
const spellings = d => { const out = [d], m = d.match(/^\/mnt\/([a-z])\/(.*)$/i); if (m) out.push(`${m[1]}:\\${m[2].replace(/\//g, '\\')}`, `${m[1]}:/${m[2]}`); return out; };

/** Build the world for one run. brain: 'on' | 'off'. Returns { runs, roster, workspace, consent, brain, dataDir }. */
export async function makeWorld({ runDir, brain: side, brainSnapshot, readOnly = [], verifyIn = [], port, claudePath, fixtures = {} }) {
  const home = os.homedir();
  const workspace = path.join(runDir, 'workspace'), dataDir = path.join(runDir, 'data'), brainDir = path.join(runDir, 'brain');
  for (const d of [workspace, dataDir]) await fsp.mkdir(d, { recursive: true });
  for (const [rel, text] of Object.entries(fixtures)) { const f = path.join(workspace, rel); await fsp.mkdir(path.dirname(f), { recursive: true }); await fsp.writeFile(f, text); }
  const realWs = await fsp.realpath(workspace);
  const clock = { now: () => Date.now() };
  const newId = (p = 'id') => `${p}_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;

  let brainApi = null;
  if (side === 'on') { await fsp.cp(brainSnapshot, brainDir, { recursive: true }); brainApi = makeBrain({ fsp, root: brainDir, clock, newId }); const b = await brainApi.init(); if (!b.ok) throw new Error(`brain copy: ${b.error}`); }

  const pathEnv = {
    home, workspace: realWs, dataDir, realpath: p => fsp.realpath(p),
    rules: hardlineRules({ home, dataDir, brainDir: side === 'on' ? await fsp.realpath(brainDir) : null, readOnlyDirs: readOnly }),
    brainNames: side === 'on' ? [brainDir] : [], readOnlyNames: readOnly.flatMap(spellings)
  };
  const roster = makeRoster({ workspace: realWs });
  roster.setReference(readOnly);
  if (side === 'off') for (const id of roster.ids()) {   // no Brain at all: no tools, no rule about it, no recall
    const c = roster.get(id); if (!c.awake) continue;
    c.grants = c.grants.filter(g => !g.startsWith('brain.')); c.grantSet = new Set(c.grants); c.systemPrompt = c.systemPrompt.replace(BRAIN_RULE, '');
  }
  const journal = makeJournal({ fsp, dir: path.join(dataDir, 'runs') }); await journal.init();
  const ledger = makeLedger({ fsp, file: path.join(dataDir, 'ledger.ndjson') });
  const bus = makeBus({ clock, journal });
  const undo = makeUndoStore({ fsp, dir: path.join(dataDir, 'undo'), newId, clock });
  const shell = makeShellExec({ spawn, pathEnv, baseEnv: process.env, killProcessGroup: killGroup });
  const registry = makeRegistry([
    makeFsRead({ fsp, pathEnv }), makeFsWrite({ fsp, pathEnv, undo }), makeFsEdit({ fsp, pathEnv, undo }), makeFsMove({ fsp, pathEnv, undo }),
    shell, makeVerifyRun({ shell }), makeWebFetch({ fetchImpl: fetch, lookup: h => dns.lookup(h, { all: true }) }),
    ...makeCrewTools({ roster }), ...(brainApi ? makeBrainTools({ brain: brainApi, roster }) : [])
  ]);
  const consent = makeSandboxConsent({ sandbox: realWs, verifyIn });
  const provider = makeClaudeCodeProvider({ spawn, claudePath, baseEnv: process.env, killProcessGroup: killGroup, cwd: realWs });
  const limits = { perRunUsd: 1, perRunTokens: 600_000, dailyUsd: Infinity, familyUsd: 2, familyTokens: 2_000_000, maxConcurrent: 2, maxWorkers: 2 };
  const runs = makeRunHost({
    bus, providers: { 'claude-code': provider }, registry, consent, ledger, roster, journal, clock, newId, newToken: () => randomBytes(32).toString('hex'),
    mcpUrl: id => `http://127.0.0.1:${port}/mcp/${id}`, limits, undo, recall: brainApi ? makeRecall({ brain: brainApi }) : null
  });
  await runs.init();
  return { runs, roster, journal, ledger, workspace: realWs, consent, dataDir };
}
