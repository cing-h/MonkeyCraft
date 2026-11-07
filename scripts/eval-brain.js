// The with/without test (docs/plans/brain-eval.md): does the Brain make the crew better?
//
//   node scripts/eval-brain.js run [--jobs 1,7] [--repeats 3]   run the jobs, Brain off and on
//   node scripts/eval-brain.js judge <dir>                       blind side-by-side judging page
//   node scripts/eval-brain.js report <dir>                      the result
//
// Results go to ~/MonkeyCraftEval/<time>/ (on this computer only: they may hold
// what the Brain knows about the user). Each run is a throwaway MonkeyCraft
// (scripts/eval/world.js) given the job through the Chief, as the user would.

import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { JOBS } from './eval/jobs.js';
import { makeWorld } from './eval/world.js';
import { makeServer } from '../src/http/server.js';
import { mcpRoutes } from '../src/routes/mcp.js';
import { renderJudgePage } from './eval/judge-page.js';
import { summarise } from './eval/report.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 8790, JUDGE_PORT = 8791, RUN_LIMIT_MS = 8 * 60_000;
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

async function settings() { try { return JSON.parse(await fsp.readFile(path.join(ROOT, 'data/settings.json'), 'utf8')); } catch { return {}; } }

async function walk(dir, base = dir, out = {}) {
  for (const d of await fsp.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) await walk(p, base, out);
    else if (d.isFile()) { const t = await fsp.readFile(p, 'utf8').catch(() => ''); out[path.relative(base, p)] = t.length > 6000 ? t.slice(0, 6000) + '\n…[cut]' : t; }
  }
  return out;
}

/** What happened in one run, from its own journal. */
async function collect(world, runId, job, started) {
  const evs = await world.journal.read(runId);
  const workerIds = evs.filter(e => e.type === 'crew.dispatch').map(e => e.workerRunId);
  const family = [evs, ...await Promise.all(workerIds.map(id => world.journal.read(id)))];
  let last = -1; evs.forEach((e, i) => { if (e.type === 'agent.tool_result' || e.type === 'crew.worker_end') last = i; });
  const end = evs.find(e => e.type === 'run.end') || {};
  const rows = await world.ledger.rows();
  const after = await walk(world.workspace), before = job.fixtures || {};
  const files = { created: {}, changed: {}, deleted: Object.keys(before).filter(p => !(p in after)) };
  for (const [p, t] of Object.entries(after)) { if (!(p in before)) files.created[p] = t; else if (before[p] !== t) files.changed[p] = t; }
  const tools = [];
  for (const e of family.flat()) if (e.type === 'agent.tool_call') tools.push({ id: e.callId, agent: e.agentId, tool: e.tool, args: JSON.stringify(e.args).slice(0, 300) });
  for (const e of family.flat()) if (e.type === 'agent.tool_result') { const t = tools.find(x => x.id === e.callId); if (t) { t.ok = e.ok; t.summary = e.summary; } }
  return {
    reason: end.reason || 'unknown', ms: Date.now() - started,
    usd: rows.reduce((a, r) => a + (r.usd || 0), 0), tokens: rows.reduce((a, r) => a + (r.tokens || 0), 0), turns: rows.reduce((a, r) => a + (r.turns || 0), 0),
    finalText: evs.slice(last + 1).filter(e => e.type === 'agent.token').map(e => e.text).join('').trim(),
    workers: family.slice(1).map(w => w[0]?.agentId).filter(Boolean),
    recalled: family.flat().filter(e => e.type === 'brain.recall').map(e => ({ agent: e.agentId, notes: e.notes, tokens: e.tokens })),
    errors: family.flat().filter(e => e.type === 'run.error').map(e => e.message.slice(0, 300)),
    tools, files, consent: world.consent.log
  };
}

async function run() {
  const ids = String(arg('jobs', JOBS.map(j => j.id).join(','))).split(',').map(Number);
  const repeats = Number(arg('repeats', 3));
  const s = await settings();
  const brainPath = s.brain?.path; if (!brainPath) throw new Error('no Brain folder in data/settings.json');
  const out = path.join(os.homedir(), 'MonkeyCraftEval', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
  await fsp.mkdir(path.join(out, 'runs'), { recursive: true });
  // one snapshot of the Brain for every "on" run, taken now (MonkeyCraft's own bookkeeping included)
  await fsp.cp(brainPath, path.join(out, 'brain-snapshot'), { recursive: true });
  const plan = shuffle(ids.flatMap(id => ['off', 'on'].flatMap(side => Array.from({ length: repeats }, (_, r) => ({ id, side, rep: r + 1 })))));
  await fsp.writeFile(path.join(out, 'plan.json'), JSON.stringify({ ids, repeats, plan, brainPath, readOnly: s.readOnly || [], started: new Date().toISOString() }, null, 1));
  const current = { runs: null };
  const server = makeServer({ port: PORT, routes: mcpRoutes({ runs: { mcpContext: (id, tok) => current.runs?.mcpContext(id, tok) ?? null } }), log: () => {} });
  await server.listen();
  console.log(`${plan.length} runs → ${out}`);
  for (const [i, p] of plan.entries()) {
    const job = JOBS.find(j => j.id === p.id), name = `job${p.id}-${p.side}-${p.rep}`;
    const runDir = path.join(os.tmpdir(), 'mc-eval', name + '-' + Date.now().toString(36));
    const world = await makeWorld({ runDir, brain: p.side, brainSnapshot: path.join(out, 'brain-snapshot'), readOnly: s.readOnly || [], verifyIn: [ROOT], port: PORT, claudePath: path.join(os.homedir(), '.local/bin/claude'), fixtures: job.fixtures });
    current.runs = world.runs;
    const started = Date.now(), r = world.runs.start({ agentId: 'chief', prompt: job.prompt });
    if (r.error) { console.log(`${name}: couldn't start: ${r.error}`); continue; }
    const timer = setTimeout(() => world.runs.halt('system'), RUN_LIMIT_MS);
    await r.done; clearTimeout(timer); await world.journal.flush();
    const res = { job: p.id, side: p.side, rep: p.rep, prompt: job.prompt, better: job.better, ...await collect(world, r.runId, job, started) };
    res.check = job.check ? job.check(res) : null;
    await fsp.writeFile(path.join(out, 'runs', name + '.json'), JSON.stringify(res, null, 1));
    console.log(`[${i + 1}/${plan.length}] ${name}: ${res.reason}, ${Math.round(res.ms / 1000)} s, ~$${res.usd.toFixed(3)}${res.check ? `, check ${res.check.pass ? 'PASS' : 'FAIL'} (${res.check.note})` : ''}`);
    await fsp.rm(runDir, { recursive: true, force: true });
  }
  await server.close();
  console.log(`Done. Judge with: node scripts/eval-brain.js judge ${out}`);
}

async function loadRuns(dir) {
  const files = (await fsp.readdir(path.join(dir, 'runs'))).filter(f => f.endsWith('.json'));
  return Promise.all(files.map(async f => JSON.parse(await fsp.readFile(path.join(dir, 'runs', f), 'utf8'))));
}
async function pairsOf(dir) {
  const file = path.join(dir, 'pairs.json');
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch {}
  const runs = await loadRuns(dir), pairs = [];
  for (const id of [...new Set(runs.map(r => r.job))].sort((a, b) => a - b)) {
    const off = runs.filter(r => r.job === id && r.side === 'off').sort((a, b) => a.rep - b.rep), on = runs.filter(r => r.job === id && r.side === 'on').sort((a, b) => a.rep - b.rep);
    for (let i = 0; i < Math.min(off.length, on.length); i++) pairs.push({ id: `${id}-${i + 1}`, job: id, onIsA: Math.random() < 0.5, off: `job${id}-off-${off[i].rep}`, on: `job${id}-on-${on[i].rep}` });
  }
  const order = pairs.map(p => p.id).sort(() => Math.random() - 0.5);   // shown in a shuffled order
  await fsp.writeFile(file, JSON.stringify({ pairs, order }, null, 1));
  return { pairs, order };
}

async function judge(dir) {
  const { pairs, order } = await pairsOf(dir), runs = Object.fromEntries((await loadRuns(dir)).map(r => [`job${r.job}-${r.side}-${r.rep}`, r]));
  const picksFile = path.join(dir, 'picks.json');
  const picks = async () => { try { return JSON.parse(await fsp.readFile(picksFile, 'utf8')); } catch { return {}; } };
  const server = http.createServer(async (req, res) => {
    if (req.headers.host !== `127.0.0.1:${JUDGE_PORT}` && req.headers.host !== `localhost:${JUDGE_PORT}`) { res.writeHead(421); return res.end(); }
    if (req.method === 'GET' && req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(renderJudgePage({ pairs, order, runs, picks: await picks() })); }
    if (req.method === 'POST' && req.url === '/pick' && req.headers['x-eval'] === '1') {
      let body = ''; for await (const c of req) body += c;
      const { id, pick, note } = JSON.parse(body || '{}');
      if (!pairs.some(p => p.id === id) || !['A', 'B', 'same'].includes(pick)) { res.writeHead(400); return res.end(); }
      const all = await picks(); all[id] = { pick, note: String(note || '').slice(0, 1000) }; await fsp.writeFile(picksFile, JSON.stringify(all, null, 1));
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ done: Object.keys(all).length, of: pairs.length }));
    }
    res.writeHead(404); res.end();
  });
  server.listen(JUDGE_PORT, '127.0.0.1', () => console.log(`Judge at http://127.0.0.1:${JUDGE_PORT}/  (${pairs.length} pairs). Press Ctrl+C when done.`));
}

async function report(dir) {
  const { pairs } = await pairsOf(dir);
  let picks = {}; try { picks = JSON.parse(await fsp.readFile(path.join(dir, 'picks.json'), 'utf8')); } catch {}
  // checks are scored again from the current jobs file, so a fixed check applies to runs already made
  const runs = (await loadRuns(dir)).map(r => { const j = JOBS.find(x => x.id === r.job); return { ...r, check: j?.check ? j.check(r) : null }; });
  const text = summarise({ runs, pairs, picks, jobs: JOBS });
  await fsp.writeFile(path.join(dir, 'report.md'), text);
  console.log(text);
}

const [cmd, dir] = process.argv.slice(2);
const go = { run, judge: () => judge(dir), report: () => report(dir) }[cmd];
if (!go || (cmd !== 'run' && !dir)) { console.log('usage: node scripts/eval-brain.js run [--jobs 1,7] [--repeats 3] | judge <dir> | report <dir>'); process.exit(1); }
go().catch(e => { console.error(e.stack || e.message); process.exit(1); });
