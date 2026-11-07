// The blind judging page: each pair of results side by side, sides hidden (A/B is
// random per pair), in a shuffled order. Picks are saved by the local judge server.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function side(label, r) {
  const files = [...Object.entries(r.files.created).map(([p, t]) => ['made', p, t]), ...Object.entries(r.files.changed).map(([p, t]) => ['changed', p, t])];
  return `<section class="side"><h3>${label}</h3>
    <pre class="answer">${esc(r.finalText || '(no final answer)')}</pre>
    ${files.map(([k, p, t]) => `<details><summary>File ${k}: ${esc(p)}</summary><pre>${esc(t)}</pre></details>`).join('')}
    ${r.files.deleted.length ? `<p class="del">Deleted: ${esc(r.files.deleted.join(', '))}</p>` : ''}
    ${r.reason !== 'done' ? `<p class="del">The job ended: ${esc(r.reason)}</p>` : ''}</section>`;
}

export function renderJudgePage({ pairs, order, runs, picks }) {
  const byId = Object.fromEntries(pairs.map(p => [p.id, p]));
  const cards = order.map((id, n) => {
    const p = byId[id], A = runs[p.onIsA ? p.on : p.off], B = runs[p.onIsA ? p.off : p.on]; if (!A || !B) return '';
    const done = picks[id]?.pick;
    return `<article class="pair${done ? ' done' : ''}" data-id="${esc(id)}">
      <header><b>${n + 1} of ${order.length}</b> · You asked: <q>${esc(A.prompt)}</q><br><small>Better means: ${esc(A.better || '')}</small></header>
      <div class="sides">${side('A', A)}${side('B', B)}</div>
      <footer><button data-pick="A"${done === 'A' ? ' class="on"' : ''}>A is better</button><button data-pick="same"${done === 'same' ? ' class="on"' : ''}>About the same</button><button data-pick="B"${done === 'B' ? ' class="on"' : ''}>B is better</button>
      <input class="note" placeholder="Why? (optional)" value="${esc(picks[id]?.note || '')}"></footer></article>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Brain test: judging</title>
<style>
:root { color-scheme: light dark; --bg: #f6f4ee; --fg: #1d1d1b; --card: #fff; --line: #d9d4c7; --pick: #2f7d32; }
@media (prefers-color-scheme: dark) { :root { --bg: #141613; --fg: #e9e6dc; --card: #1d211c; --line: #3a4036; --pick: #7cbc55; } }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
h1 { font-size: 20px; margin: 0 0 4px; } .lead { margin: 0 0 16px; max-width: 70ch; }
.pair { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px; margin: 0 0 16px; }
.pair.done { opacity: .7; } .sides { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 8px 0; }
@media (max-width: 800px) { .sides { grid-template-columns: 1fr; } }
.side { border: 1px solid var(--line); border-radius: 6px; padding: 8px; min-width: 0; } .side h3 { margin: 0 0 6px; font-size: 14px; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 14px/1.45 system-ui, sans-serif; margin: 0; } details pre { font-family: ui-monospace, monospace; font-size: 12px; margin-top: 4px; }
.del { color: #b3261e; } footer { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
button { font: inherit; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--line); background: transparent; color: inherit; cursor: pointer; }
button.on { border-color: var(--pick); outline: 2px solid var(--pick); } .note { flex: 1; min-width: 160px; font: inherit; padding: 6px; border-radius: 6px; border: 1px solid var(--line); background: transparent; color: inherit; }
#progress { position: sticky; top: 0; background: var(--bg); padding: 6px 0; font-weight: 600; }
</style></head><body>
<h1>Does the Brain help? Blind judging</h1>
<p class="lead">Each pair is the same job done twice, once with the Brain and once without. You don't know which side is which. Pick the better result, or "about the same". Your picks are saved on this computer as you go.</p>
<p id="progress"></p>
${cards}
<script>
const prog = () => { const n = document.querySelectorAll('.pair').length, d = document.querySelectorAll('.pair.done').length; document.getElementById('progress').textContent = d + ' of ' + n + ' judged' + (d === n ? ' — all done, thank you! Close this page.' : ''); };
document.addEventListener('click', async e => {
  const b = e.target.closest('button[data-pick]'); if (!b) return;
  const card = b.closest('.pair'), note = card.querySelector('.note').value;
  const r = await fetch('/pick', { method: 'POST', headers: { 'content-type': 'application/json', 'x-eval': '1' }, body: JSON.stringify({ id: card.dataset.id, pick: b.dataset.pick, note }) });
  if (!r.ok) return alert('Could not save that pick.');
  card.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); card.classList.add('done'); prog();
});
prog();
</script></body></html>`;
}
