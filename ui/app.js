// AutoCraft chat UI. Everything shown here comes from the live event stream:
// if an event didn't arrive, the page doesn't pretend it happened.

const $ = id => document.getElementById(id);
const H = { 'content-type': 'application/json', 'x-autocraft': '1' };
const post = (url, body) => fetch(url, { method: 'POST', headers: H, body: JSON.stringify(body || {}) }).then(async r => ({ ok: r.ok, data: await r.json().catch(() => ({})) }));
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

let crew = [];
const names = {};
const runs = new Map();   // runId -> { box, say, tools: Map, asks: Map }
const seen = new Set();
const busy = new Set();

async function loadCrew() {
  const r = await fetch('/api/roster').then(r => r.json());
  crew = r.crew; for (const c of crew) names[c.id] = c.name;
  renderCrew();
}
function renderCrew() {
  const ul = $('crew'); ul.replaceChildren();
  for (const c of crew) {
    const li = el('li', c.awake ? (busy.has(c.id) ? 'busy' : '') : 'asleep');
    li.append(el('span', 'n', c.name), el('span', 'r', c.role), el('span', 'st', !c.awake ? `ASLEEP · WAKES ${String(c.wakes).toUpperCase()}` : busy.has(c.id) ? 'WORKING' : 'READY'));
    ul.append(li);
  }
}
async function loadSpend() {
  try {
    const { today } = await fetch('/api/spend').then(r => r.json());
    $('spend').textContent = `TODAY · ${today.runs} JOBS · ${fmtTokens(today.tokens)} TOKENS · ~$${today.usd.toFixed(2)}`;
  } catch {}
}
const fmtTokens = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n);

function runBox(ev) {
  let r = runs.get(ev.runId);
  if (!r) {
    $('empty')?.remove();
    const box = el('section', 'run');
    r = { box, say: null, tools: new Map(), asks: new Map() };
    runs.set(ev.runId, r);
    $('log').append(box);
  }
  return r;
}
function saying(r, ev) {
  if (!r.say) { r.box.append(el('div', 'who', (names[ev.agentId] || ev.agentId).toUpperCase())); r.say = el('div', 'say'); r.box.append(r.say); }
  return r.say;
}
function scroll() { const l = $('log'); if (l.scrollHeight - l.scrollTop - l.clientHeight < 200) l.scrollTop = l.scrollHeight; }

const REASONS = { done: 'DONE', cancelled: 'CANCELLED', error: 'FAILED', max_iters: 'STOPPED: TOO MANY STEPS', budget: 'STOPPED: SPENDING LIMIT', halted: 'STOPPED BY STOP BUTTON', stale: 'STOPPED: NO PROGRESS' };

function onEvent(ev) {
  const key = ev.runId + ':' + ev.seq; if (seen.has(key)) return; seen.add(key);
  logEvent(ev);
  const r = runBox(ev);
  switch (ev.type) {
    case 'run.start':
      r.box.append(el('div', 'you', ev.task || '(job)'));
      busy.add(ev.agentId); renderCrew(); break;
    case 'agent.token': saying(r, ev).textContent += ev.text; break;
    case 'agent.tool_call': {
      r.say = null; // text after a tool call starts a new paragraph
      const t = el('div', 'tool'); const b = el('b', '', ev.tool); t.append(b, document.createTextNode(' ' + argText(ev.args) + ' …'));
      r.tools.set(ev.callId, t); r.box.append(t); break;
    }
    case 'agent.tool_result': {
      const t = r.tools.get(ev.callId); if (!t) break;
      t.className = 'tool ' + (ev.isError ? 'err' : 'ok');
      t.lastChild.textContent = t.lastChild.textContent.replace(/ …$/, '') + ' → ' + ev.summary; break;
    }
    case 'permission.prompt': r.box.append(askCard(r, ev)); break;
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
      busy.delete(ev.agentId); renderCrew(); loadSpend(); break;
    }
  }
  scroll();
}
const argText = a => { const s = a && (a.command || a.path) ? (a.command || a.path) : JSON.stringify(a); return s.length > 120 ? s.slice(0, 117) + '…' : s; };

function askCard(r, ev) {
  const a = el('div', 'ask');
  const what = ev.scope === 'execute' ? 'wants to run this command' : 'wants to make this change';
  a.append(el('div', 'q', `${(names[ev.agentId] || ev.agentId).toUpperCase()} ${what.toUpperCase()}${ev.outsideWorkspace ? ' · OUTSIDE THE WORKSPACE' : ''}`), el('code', '', ev.summary));
  const btns = el('div', 'btns');
  const answer = async d => {
    for (const b of btns.children) b.disabled = true;
    const res = await post('/api/permission', { promptId: ev.promptId, decision: d });
    if (!res.ok) { a.append(el('div', 'ans', res.data.error || 'Could not send your answer.')); }
  };
  const mk = (label, cls, d) => { const b = el('button', cls, label); b.type = 'button'; b.onclick = () => answer(d); btns.append(b); };
  mk('Allow once', 'allow', 'allow_once');
  if (!ev.outsideWorkspace) mk('Allow for this session', 'allow', 'allow_session');
  mk('Deny', 'deny', 'deny');
  a.append(btns); r.asks.set(ev.promptId, a);
  return a;
}

function logEvent(ev) {
  const li = el('li'); const time = new Date(ev.ts).toLocaleTimeString();
  li.append(document.createTextNode(time + ' '), el('span', 't', ev.type), document.createTextNode(' ' + (names[ev.agentId] || ev.agentId)));
  li.title = JSON.stringify(ev);
  const ol = $('events'); ol.append(li);
  if (ol.children.length > 600) ol.firstChild.remove();
  const box = ol.parentElement; box.scrollTop = box.scrollHeight;
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

await loadCrew();
loadSpend();
const es = new EventSource('/api/events');
es.onmessage = m => { try { onEvent(JSON.parse(m.data)); } catch (e) { console.error(e); } };
