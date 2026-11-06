// MonkeyCraft UI. Everything shown here comes from the live event stream: the
// job log, the crew strip and the ape village all read the same events.
// If an event didn't arrive, nothing on the page pretends it happened.

import { initialState, reduce, modeOf, MODE_TEXT } from './station/state.js';
import { makeStation, CREW_IDS, SCENE_W } from './station/ape/scene.js';

const $ = id => document.getElementById(id);
const H = { 'content-type': 'application/json', 'x-monkeycraft': '1' };
const post = (url, body) => fetch(url, { method: 'POST', headers: H, body: JSON.stringify(body || {}) }).then(async r => ({ ok: r.ok, data: await r.json().catch(() => ({})) }));
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const fmtTokens = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n);

let crew = [], state = null, station = null, filter = null;
const names = {}, wakes = {};
const runs = new Map();   // runId -> { box, agentId, say, tools: Map, asks: Map }
const seen = new Set();

// ---------- answering permission (shared by the log card and the floor bubble) ----------
const answered = new Set();
async function answer(promptId, decision, buttons) {
  if (answered.has(promptId)) return;
  answered.add(promptId);
  for (const b of buttons) b.disabled = true;
  const res = await post('/api/permission', { promptId, decision });
  if (!res.ok) { answered.delete(promptId); for (const b of buttons) b.disabled = false; alert(res.data.error || 'Could not send your answer.'); }
}
function answerButtons(ask, container) {
  const list = [];
  const mk = (label, cls, d) => { const b = el('button', cls, label); b.type = 'button'; b.onclick = () => answer(ask.promptId, d, document.querySelectorAll(`[data-prompt="${ask.promptId}"] button`)); container.append(b); list.push(b); };
  mk('Allow once', 'allow', 'allow_once');
  if (!ask.outsideWorkspace) { mk('Allow for this session', 'allow', 'allow_session'); mk('Always allow', 'allow', 'allow_always'); }
  mk('Deny', 'deny', 'deny');
  return list;
}

// ---------- job log ----------
function runBox(ev) {
  let r = runs.get(ev.runId);
  if (!r) {
    $('empty')?.remove();
    const box = el('section', 'run'); box.dataset.agent = ev.agentId;
    const parent = ev.type === 'run.start' && ev.parentRunId ? runs.get(ev.parentRunId) : null;
    if (filter && filter !== ev.agentId && !(parent && parent.agentId === filter)) box.classList.add('hide');
    r = { box, agentId: ev.agentId, say: null, tools: new Map(), asks: new Map(), undos: 0, ended: false, revertBtn: null, parent };
    if (ev.type !== 'run.start') box.append(el('div', 'foot', `EARLIER JOB · ${(names[ev.agentId] || ev.agentId).toUpperCase()}`));
    runs.set(ev.runId, r);
    if (parent) { box.classList.add('worker'); parent.say = null; parent.box.append(box); }   // a crew member's job sits inside the Chief's
    else $('log').append(box);
  }
  return r;
}
function saying(r, ev) {
  if (!r.say) { r.box.append(el('div', 'who', (names[ev.agentId] || ev.agentId).toUpperCase())); r.say = el('div', 'say'); r.box.append(r.say); }
  return r.say;
}
const REASONS = { done: 'DONE', cancelled: 'CANCELLED', error: 'FAILED', max_iters: 'STOPPED: TOO MANY STEPS', budget: 'STOPPED: SPENDING LIMIT', halted: 'STOPPED BY STOP BUTTON', stale: 'STOPPED: NO PROGRESS' };
const argText = a => {
  const s = !a ? '' : a.command || a.path || (a.worker && a.task ? `${a.worker}: ${a.task}` : '') || a.url || a.query || (a.from && a.to ? `${a.from} → ${a.to}` : '') || (Array.isArray(a.jobs) ? a.jobs.join(', ') : '') || JSON.stringify(a);
  return s.length > 140 ? s.slice(0, 137) + '…' : s;
};

function logRun(ev) {
  const r = runBox(ev);
  switch (ev.type) {
    case 'run.start':
      if (r.parent) r.box.append(el('div', 'who', `${(names[ev.agentId] || ev.agentId).toUpperCase()} · TASK FROM ${(names[r.parent.agentId] || r.parent.agentId).toUpperCase()}`), el('div', 'task', ev.task || '(task)'));
      else r.box.append(el('div', 'you', ev.task || '(job)'));
      break;
    case 'crew.dispatch': r.say = null; r.box.append(el('div', 'note', `SENT ${(names[ev.workerId] || ev.workerId).toUpperCase()}`)); break;
    case 'crew.worker_end': r.say = null; r.box.append(el('div', ev.reason === 'done' ? 'note' : 'warn', `${(names[ev.workerId] || ev.workerId).toUpperCase()} FINISHED: ${REASONS[ev.reason] || ev.reason.toUpperCase()}`)); break;
    case 'agent.token': saying(r, ev).textContent += ev.text; break;
    case 'agent.tool_call': {
      r.say = null;
      const t = el('div', 'tool'); t.append(el('b', '', ev.tool), document.createTextNode(' ' + argText(ev.args) + ' …'));
      r.tools.set(ev.callId, t); r.box.append(t); break;
    }
    case 'agent.tool_result': {
      const t = r.tools.get(ev.callId); if (!t) break;
      t.className = 'tool ' + (ev.isError ? 'err' : 'ok');
      t.lastChild.textContent = t.lastChild.textContent.replace(/ …$/, '') + ' → ' + ev.summary; break;
    }
    case 'permission.prompt': {
      const a = el('div', 'ask'); a.dataset.prompt = ev.promptId;
      const what = ev.scope === 'execute' ? 'wants to run this command' : 'wants to make this change';
      a.append(el('div', 'q', `${(names[ev.agentId] || ev.agentId).toUpperCase()} ${what.toUpperCase()}${ev.outsideWorkspace ? ' · OUTSIDE THE WORKSPACE' : ''}`), el('code', '', ev.summary));
      const btns = el('div', 'btns'); answerButtons(ev, btns); a.append(btns);
      r.asks.set(ev.promptId, a); r.box.append(a); break;
    }
    case 'permission.response': {
      if (ev.by === 'rule') { r.box.append(el('div', 'note', `ALLOWED BY YOUR REMEMBERED ANSWER (${ev.decision === 'allow_always' ? 'ALWAYS' : 'THIS SESSION'})`)); break; }
      const a = r.asks.get(ev.promptId); if (!a) break;
      a.className = 'ask done'; a.querySelector('.btns')?.remove();
      a.append(el('div', 'ans', ev.decision === 'deny' ? (ev.by === 'user' ? 'YOU SAID NO' : 'DENIED') : ev.decision === 'allow_session' ? 'ALLOWED FOR THIS SESSION' : ev.decision === 'allow_always' ? 'ALWAYS ALLOWED (YOU CAN FORGET THIS UNDER REMEMBERED ANSWERS)' : 'ALLOWED ONCE'));
      if (ev.decision === 'allow_always') loadGrants();
      break;
    }
    case 'run.error': r.box.append(el('div', 'error', ev.message)); break;
    case 'taint.set': r.box.append(el('div', 'lock', `READ WEB CONTENT (${ev.source}). FOR SAFETY, COMMANDS AND FILE CHANGES ARE LOCKED FOR THE REST OF THIS JOB.`)); break;
    case 'breaker.trip': r.box.append(el('div', 'warn', ev.kind === 'repeat' ? `PAUSED A REPEATED STEP: ${ev.detail}` : `STOPPING: ${ev.detail}, NO PROGRESS`)); break;
    case 'budget.threshold': {
      const what = { tokens: `${fmtTokens(ev.spent)} of ${fmtTokens(ev.limit)} tokens`, run: `~$${ev.spent.toFixed(2)} of the $${ev.limit} job limit`, day: `today's spend ~$${ev.spent.toFixed(2)} of the $${ev.limit} daily limit` }[ev.scope] || `${ev.spent} of ${ev.limit}`;
      r.box.append(el('div', ev.hard ? 'error' : 'warn', ev.hard ? `SPENDING LIMIT REACHED: ${what}. THE JOB WAS STOPPED.` : `SPENDING WARNING: ${what}.`)); break;
    }
    case 'undo.saved': r.undos++; break;
    case 'undo.reverted': r.box.append(el('div', 'note', `REVERTED ${ev.path}`)); if (r.revertBtn) { r.revertBtn.disabled = true; r.revertBtn.textContent = 'Reverted'; } break;
    case 'station.halt': r.box.append(el('div', 'error', 'STOP pressed: halting.')); break;
    case 'agent.cost': r.cost = ev; break;
    case 'run.end': {
      const c = r.cost, est = c && c.billing === 'subscription' ? ' (subscription: estimate, not charged)' : '';
      if (r.parent) r.parent.say = null;
      r.box.append(el('div', 'foot', `${REASONS[ev.reason] || ev.reason.toUpperCase()} · ${ev.turns} TURNS · ${fmtTokens(ev.tokens)} TOKENS · ~$${ev.usd.toFixed(3)}${est}`));
      r.ended = true;
      for (const q of r.asks.values()) if (!q.classList.contains('done')) { q.className = 'ask done'; q.querySelector('.btns')?.remove(); q.append(el('div', 'ans', 'NO LONGER WAITING: THE JOB ENDED')); }
      if (r.undos) addRevert(r, ev.runId);
      loadSpend(); break;
    }
  }
  const l = $('log'); if (l.scrollHeight - l.scrollTop - l.clientHeight < 200) l.scrollTop = l.scrollHeight;
}

// "Revert this job": undo every file change it made (newer edits are never overwritten)
function addRevert(r, runId) {
  const b = el('button', 'revert', `Revert this job (${r.undos} file change${r.undos > 1 ? 's' : ''})`); b.type = 'button';
  b.onclick = async () => {
    b.disabled = true; b.textContent = 'Reverting…';
    const res = await post(`/api/runs/${runId}/revert`);
    if (!res.ok) { b.disabled = false; b.textContent = 'Revert this job'; alert(res.data.error || 'Could not revert.'); return; }
    const skipped = res.data.results.filter(x => x.result.startsWith('skipped') && !x.result.includes('already'));
    for (const x of skipped) r.box.append(el('div', 'warn', `NOT REVERTED ${x.path}: ${x.result.slice(9)}`));
    b.textContent = skipped.length ? 'Reverted (some files skipped)' : 'Reverted';
  };
  r.revertBtn = b; r.box.append(b);
}

function logEvent(ev) {
  const li = el('li');
  li.append(document.createTextNode(new Date(ev.ts).toLocaleTimeString() + ' '), el('span', 't', ev.type), document.createTextNode(' ' + (names[ev.agentId] || ev.agentId)));
  li.title = JSON.stringify(ev);
  const ol = $('events'); ol.append(li);
  if (ol.children.length > 600) ol.firstChild.remove();
  ol.scrollTop = ol.scrollHeight;
}

function onEvent(ev) {
  const key = ev.runId + ':' + ev.seq; if (seen.has(key)) return; seen.add(key);
  reduce(state, ev);
  logEvent(ev);
  logRun(ev);
  if (station) { syncStrip(Date.now()); syncBubbles(); } // show questions at once, not on the next tick
}

// ---------- filter (click a creature to see only its jobs) ----------
function setFilter(id) {
  filter = filter === id ? null : id;
  for (const r of runs.values()) r.box.classList.toggle('hide', !!filter && r.agentId !== filter && !(r.parent && r.parent.agentId === filter) && !(!r.parent && [...runs.values()].some(w => w.parent === r && w.agentId === filter)));
  const f = $('filter'); f.hidden = !filter;
  if (filter) f.textContent = `Showing ${names[filter]} · show all`;
  lastStrip = '';
}
$('filter').onclick = () => setFilter(filter);

// ---------- crew strip + floor bubbles ----------
let lastStrip = '';
function syncStrip(now) {
  const modes = crew.map(c => modeOf(state.creatures[c.id], now));
  const sig = modes.join() + filter;
  if (sig === lastStrip) return; lastStrip = sig;
  const ul = $('crew-status'); ul.replaceChildren();
  crew.forEach((c, i) => {
    const m = modes[i], li = el('li', m + (filter === c.id ? ' sel' : ''));
    li.append(el('span', 'n', c.name.toUpperCase()), el('span', 'st', m === 'asleep' ? `Asleep · wakes in ${wakes[c.id]}` : MODE_TEXT[m]));
    li.tabIndex = 0; li.onclick = () => setFilter(c.id); li.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFilter(c.id); } };
    ul.append(li);
  });
}
const bubbles = new Map(); // promptId -> element
function syncBubbles() {
  const live = new Set();
  for (const id of CREW_IDS) {
    const c = state.creatures[id], ask = c && c.asks[0]; if (!ask) continue;
    live.add(ask.promptId);
    let b = bubbles.get(ask.promptId);
    if (!b) {
      b = el('div', 'bubble'); b.dataset.prompt = ask.promptId; b.setAttribute('role', 'dialog'); b.setAttribute('aria-label', `${names[id]} needs your OK`);
      b.append(el('div', 'q', `${names[id].toUpperCase()} ${ask.scope === 'execute' ? 'WANTS TO RUN' : 'WANTS TO CHANGE'}${ask.outsideWorkspace ? ' · OUTSIDE THE WORKSPACE' : ''}`), el('code', '', ask.summary));
      const btns = el('div', 'btns'); answerButtons(ask, btns); b.append(btns);
      $('overlay').append(b); bubbles.set(ask.promptId, b);
    }
    if (!b.dataset.shown) { b.dataset.shown = '1'; station.scrollTo(station.positionOf(id)); station.redraw(Date.now()); syncThumb(); } // bring the asker into view
    const [x, y] = station.anchor(id);
    b.style.left = Math.max(170, Math.min(x, $('stage').clientWidth - 170)) + 'px';
    b.style.top = Math.max(b.offsetHeight + 14, y) + 'px';
  }
  for (const [pid, b] of bubbles) if (!live.has(pid)) { b.remove(); bubbles.delete(pid); }
}

// ---------- spend, roster, controls ----------
async function loadSpend() {
  try {
    const { today, limits } = await fetch('/api/spend').then(r => r.json());
    $('spend').textContent = `TODAY · ${today.runs} JOBS · ${fmtTokens(today.tokens)} TOKENS · ~$${today.usd.toFixed(2)} OF $${limits.dailyUsd}`;
    $('spend').classList.toggle('near', today.usd >= 0.8 * limits.dailyUsd);
  } catch {}
}

$('composer').addEventListener('submit', async e => {
  e.preventDefault();
  const prompt = $('prompt').value.trim(); if (!prompt) return;
  $('send').disabled = true;
  const agentId = $('to').value;
  let r = await post('/api/run', { agentId, prompt });
  if (!r.ok && r.data.code === 'daily_cap' && confirm(`${r.data.error}\n\nRun this job anyway?`)) r = await post('/api/run', { agentId, prompt, allowOverDaily: true });
  $('send').disabled = false;
  if (!r.ok) { if (r.data.code !== 'daily_cap') alert(r.data.error || 'Could not start the job.'); return; }
  $('prompt').value = '';
});
$('prompt').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('composer').requestSubmit(); } });
$('stop').addEventListener('click', () => post('/api/halt'));

const roster = await fetch('/api/roster').then(r => r.json());
crew = CREW_IDS.map(id => roster.crew.find(c => c.id === id)).filter(Boolean);
for (const c of crew) { names[c.id] = c.name; wakes[c.id] = c.wakes; }
// who the prompt box talks to: the Chief by default, or any awake crew member directly
{
  const to = $('to');
  for (const c of [...crew].sort((a, b) => (a.id === 'chief' ? -1 : b.id === 'chief' ? 1 : 0))) if (c.awake) to.append(Object.assign(document.createElement('option'), { value: c.id, textContent: c.id === 'chief' ? `${c.name} (hands out the work)` : `${c.name} directly` }));
  const sync = () => { const n = names[to.value] || 'the crew'; $('prompt').placeholder = `A job for ${n.replace(/^The /, 'the ')}…`; $('prompt-label').textContent = `Job for ${n}`; };
  to.onchange = sync; sync();
}
state = initialState(crew);

const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
station = makeStation($('scene'), { modeOf: (id, now) => modeOf(state.creatures[id], now ?? Date.now()), reduced });
// scrolling the village: buttons, arrow keys and drag; a click without a drag picks a crew member
const WORLD_W = 960;
function syncThumb() { const t = $('thumb'); t.style.width = (SCENE_W / WORLD_W * 100) + '%'; t.style.left = (station.camera() / WORLD_W * 100) + '%'; }
const scrollBy = dx => { station.scrollBy(dx); station.redraw(Date.now()); syncThumb(); syncBubbles(); };
$('scroll-l').onclick = () => scrollBy(-120);
$('scroll-r').onclick = () => scrollBy(120);
const canvas = $('scene');
canvas.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') { e.preventDefault(); scrollBy(-24); } if (e.key === 'ArrowRight') { e.preventDefault(); scrollBy(24); } });
let drag = null;
canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, moved: 0 }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const r = canvas.getBoundingClientRect(), dx = (e.clientX - drag.x) / r.width * SCENE_W;
  if (Math.abs(e.clientX - drag.x) > 3 || drag.moved) { drag.moved += Math.abs(dx); canvas.classList.add('dragging'); drag.x = e.clientX; scrollBy(-dx); }
});
canvas.addEventListener('pointerup', e => {
  const was = drag; drag = null; canvas.classList.remove('dragging');
  if (was && was.moved < 2) { const r = canvas.getBoundingClientRect(), id = station.pick(e.clientX - r.left, e.clientY - r.top); if (id) setFilter(id); }
});
station.scrollTo(station.positionOf('chief')); syncThumb();

// remembered answers: list them, forget any
async function loadGrants() {
  try {
    const { grants } = await fetch('/api/grants').then(r => r.json());
    const ul = $('grants'); ul.replaceChildren();
    $('grants-count').textContent = grants.length ? ` (${grants.length})` : '';
    if (!grants.length) { ul.append(el('li', 'empty', 'None yet. When you choose "Always allow", it is listed here.')); return; }
    for (const g of grants) {
      const li = el('li'); li.append(el('code', '', g.summary.split('\n')[0]));
      const b = el('button', '', 'Forget'); b.type = 'button';
      b.onclick = async () => { b.disabled = true; await post('/api/grants/forget', { key: g.key }); loadGrants(); };
      li.append(b); ul.append(li);
    }
  } catch {}
}

// ---------- settings ----------
let settingsView = null;
const LIMIT_KEYS = ['perRunUsd', 'perRunTokens', 'familyUsd', 'familyTokens', 'dailyUsd'];
async function openSettings() {
  settingsView = await fetch('/api/settings').then(r => r.json());
  const { effective, options } = settingsView, api = options.providers.find(p => p.id === 'anthropic-api');
  $('api-status').textContent = api.available ? 'An Anthropic API key was found, so crew members can use the API.' : 'Everyone uses Claude Code on your subscription. ' + api.why;
  const rows = $('crew-rows'); rows.replaceChildren();
  for (const c of effective.crew) {
    const tr = el('tr'); tr.append(el('th', '', c.name));
    const sel = (id, opts, val) => { const s2 = el('select'); s2.id = id; for (const o of opts) s2.append(Object.assign(el('option', '', o.label), { value: o.id, disabled: !!o.disabled })); s2.value = val; return s2; };
    const p = sel(`prov-${c.id}`, options.providers.map(o => ({ id: o.id, label: o.label, disabled: !o.available })), c.provider);
    const m = sel(`model-${c.id}`, options.models.map(x => ({ id: x, label: x.replace('claude-', '').replace(/-(\d)-(\d)$/, ' $1.$2') })), c.model);
    p.setAttribute('aria-label', `${c.name} thinks with`); m.setAttribute('aria-label', `${c.name}'s model`);
    const td1 = el('td'), td2 = el('td'); td1.append(p); td2.append(m); tr.append(td1, td2); rows.append(tr);
  }
  for (const k of LIMIT_KEYS) { const i = $(`lim-${k}`), r = options.ranges[k]; i.min = r[0]; i.max = r[1]; i.value = effective.limits[k]; }
  $('settings-error').hidden = true;
  $('settings').showModal();
}
$('open-settings').onclick = () => openSettings().catch(e => alert('Could not load settings: ' + e.message));
$('settings-cancel').onclick = () => $('settings').close();
$('settings-form').addEventListener('submit', async e => {
  e.preventDefault();
  const crewS = {}, limits = {};
  for (const c of settingsView.effective.crew) crewS[c.id] = { provider: $(`prov-${c.id}`).value, model: $(`model-${c.id}`).value };
  for (const k of LIMIT_KEYS) limits[k] = Number($(`lim-${k}`).value);
  const res = await post('/api/settings', { crew: crewS, limits });
  if (!res.ok) { const er = $('settings-error'); er.textContent = res.data.error || 'Could not save.'; er.hidden = false; return; }
  $('settings').close(); loadSpend();
});

loadSpend(); loadGrants();
if (location.hash === '#settings') openSettings().catch(() => {});
const es = new EventSource('/api/events');
es.onmessage = m => { try { onEvent(JSON.parse(m.data)); } catch (e) { console.error(e); } };

// draw at once (don't wait for the first tick), then 20 steps a second so moves flow smoothly
station.step(Date.now(), 0.05); syncStrip(Date.now());
setInterval(() => { const now = Date.now(); station.step(now, 0.05); syncStrip(now); syncBubbles(); }, 50);
