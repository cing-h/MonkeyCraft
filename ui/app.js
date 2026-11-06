// MonkeyCraft UI. Everything shown here comes from the live event stream: the
// job log, the crew strip and the station floor all read the same events.
// If an event didn't arrive, nothing on the page pretends it happened.

import { initialState, reduce, modeOf, MODE_TEXT } from './station/state.js';
import { makeStation, CREW_IDS } from './station/scene.js';

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
  if (!ask.outsideWorkspace) mk('Allow for this session', 'allow', 'allow_session');
  mk('Deny', 'deny', 'deny');
  return list;
}

// ---------- job log ----------
function runBox(ev) {
  let r = runs.get(ev.runId);
  if (!r) {
    $('empty')?.remove();
    const box = el('section', 'run'); box.dataset.agent = ev.agentId;
    if (filter && filter !== ev.agentId) box.classList.add('hide');
    r = { box, agentId: ev.agentId, say: null, tools: new Map(), asks: new Map() };
    if (ev.type !== 'run.start') box.append(el('div', 'foot', `EARLIER JOB · ${(names[ev.agentId] || ev.agentId).toUpperCase()}`));
    runs.set(ev.runId, r); $('log').append(box);
  }
  return r;
}
function saying(r, ev) {
  if (!r.say) { r.box.append(el('div', 'who', (names[ev.agentId] || ev.agentId).toUpperCase())); r.say = el('div', 'say'); r.box.append(r.say); }
  return r.say;
}
const REASONS = { done: 'DONE', cancelled: 'CANCELLED', error: 'FAILED', max_iters: 'STOPPED: TOO MANY STEPS', budget: 'STOPPED: SPENDING LIMIT', halted: 'STOPPED BY STOP BUTTON', stale: 'STOPPED: NO PROGRESS' };
const argText = a => { const s = a && (a.command || a.path) ? (a.command || a.path) : JSON.stringify(a); return s.length > 120 ? s.slice(0, 117) + '…' : s; };

function logRun(ev) {
  const r = runBox(ev);
  switch (ev.type) {
    case 'run.start': r.box.append(el('div', 'you', ev.task || '(job)')); break;
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
      const a = r.asks.get(ev.promptId); if (!a) break;
      a.className = 'ask done'; a.querySelector('.btns')?.remove();
      a.append(el('div', 'ans', ev.decision === 'deny' ? (ev.by === 'user' ? 'YOU SAID NO' : 'DENIED') : ev.decision === 'allow_session' ? 'ALLOWED FOR THIS SESSION' : 'ALLOWED ONCE'));
      break;
    }
    case 'run.error': r.box.append(el('div', 'error', ev.message)); break;
    case 'station.halt': r.box.append(el('div', 'error', 'STOP pressed: halting.')); break;
    case 'agent.cost': r.cost = ev; break;
    case 'run.end': {
      const c = r.cost, est = c && c.billing === 'subscription' ? ' (subscription: estimate, not charged)' : '';
      r.box.append(el('div', 'foot', `${REASONS[ev.reason] || ev.reason.toUpperCase()} · ${ev.turns} TURNS · ${fmtTokens(ev.tokens)} TOKENS · ~$${ev.usd.toFixed(3)}${est}`));
      loadSpend(); break;
    }
  }
  const l = $('log'); if (l.scrollHeight - l.scrollTop - l.clientHeight < 200) l.scrollTop = l.scrollHeight;
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
  for (const r of runs.values()) r.box.classList.toggle('hide', !!filter && r.agentId !== filter);
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
    const [x, y] = station.anchor(id);
    b.style.left = Math.max(170, Math.min(x, $('stage').clientWidth - 170)) + 'px';
    b.style.top = Math.max(b.offsetHeight + 14, y) + 'px';
  }
  for (const [pid, b] of bubbles) if (!live.has(pid)) { b.remove(); bubbles.delete(pid); }
}

// ---------- spend, roster, controls ----------
async function loadSpend() {
  try {
    const { today } = await fetch('/api/spend').then(r => r.json());
    $('spend').textContent = `TODAY · ${today.runs} JOBS · ${fmtTokens(today.tokens)} TOKENS · ~$${today.usd.toFixed(2)}`;
  } catch {}
}

$('composer').addEventListener('submit', async e => {
  e.preventDefault();
  const prompt = $('prompt').value.trim(); if (!prompt) return;
  $('send').disabled = true;
  const r = await post('/api/run', { agentId: 'smith', prompt });
  $('send').disabled = false;
  if (!r.ok) { alert(r.data.error || 'Could not start the job.'); return; }
  $('prompt').value = '';
});
$('prompt').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('composer').requestSubmit(); } });
$('stop').addEventListener('click', () => post('/api/halt'));

const roster = await fetch('/api/roster').then(r => r.json());
crew = CREW_IDS.map(id => roster.crew.find(c => c.id === id)).filter(Boolean);
for (const c of crew) { names[c.id] = c.name; wakes[c.id] = c.wakes; }
state = initialState(crew);

const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
station = makeStation($('scene'), { modeOf: (id, now) => modeOf(state.creatures[id], now ?? Date.now()), reduced });
$('scene').addEventListener('click', e => {
  const r = $('scene').getBoundingClientRect(), id = station.pick(e.clientX - r.left, e.clientY - r.top);
  if (id) setFilter(id);
});
const rotate = d => { $('cam-label').textContent = `CAMERA ${station.rotate(d)}°`; station.redraw(Date.now()); };
$('rot-l').onclick = () => rotate(-1);
$('rot-r').onclick = () => rotate(1);

loadSpend();
const es = new EventSource('/api/events');
es.onmessage = m => { try { onEvent(JSON.parse(m.data)); } catch (e) { console.error(e); } };

// draw at once (don't wait for the first tick), then ~10 steps a second for the pixel-art cadence
station.step(Date.now()); syncStrip(Date.now());
setInterval(() => { const now = Date.now(); station.step(now); syncStrip(now); syncBubbles(); }, 100);
