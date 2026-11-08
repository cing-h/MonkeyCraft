// The interview with the Sage: a chat panel with a ten-minute clock. The Sage
// asks, you answer or skip; at the end you read (and can edit) the draft of your
// profile, then save it to the Brain or throw it away. The conversation is held
// only in MonkeyCraft's memory until you save; it is never written to the job log.

export function initInterview({ $, el, post }) {
  const dlg = $('interview-dialog');
  let view = { active: false }, tick = null;
  const get = () => fetch('/api/sage/interview').then(r => r.json());
  const oops = msg => { const e = $('interview-error'); e.textContent = msg || ''; e.hidden = !msg; };
  const clock = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  function render() {
    const v = view, chat = $('interview-chat');
    $('interview-start').hidden = v.active || v.status === 'drafted';
    $('interview-answer').hidden = !v.active;
    $('interview-draft').hidden = v.status !== 'drafted';
    $('interview-clock').textContent = v.active ? `${clock(v.secondsLeft)} left` : v.status === 'drafted' ? 'Draft ready' : '';
    const turns = v.turns || [];
    chat.replaceChildren(...(!turns.length && !v.active ? [el('p', 'hint', 'About ten minutes. The Sage asks the most important things first; skip anything you like. Nothing is saved until you approve the draft at the end.')] : []),
      ...turns.flatMap(t => [el('div', 'iv-q', t.q), ...(t.a !== null || t.skipped ? [el('div', 'iv-a' + (t.skipped ? ' skipped' : ''), t.skipped ? '(skipped)' : t.a)] : [])]));
    if (v.active && !v.waiting) chat.append(el('div', 'iv-think', 'The Sage is thinking…'));
    chat.scrollTop = chat.scrollHeight;
    const waiting = v.active && v.waiting;
    for (const id of ['interview-text', 'interview-send', 'interview-skip']) $(id).disabled = !waiting;
    if (v.status === 'drafted' && !$('interview-notes').dataset.filled) {
      const box = $('interview-notes'); box.replaceChildren(); box.dataset.filled = '1';
      for (const n of v.draft) {
        const f = el('div', 'iv-note');
        const t = Object.assign(el('input'), { value: n.title, type: 'text' }); t.setAttribute('aria-label', 'Note title');
        const x = Object.assign(el('textarea'), { value: n.text, rows: Math.min(12, n.text.split('\n').length + 1) }); x.setAttribute('aria-label', `The note "${n.title}"`);
        const drop = el('button', '', 'Leave out'); drop.type = 'button'; drop.onclick = () => f.remove();
        f.append(t, x, drop); box.append(f);
      }
    }
  }

  async function refresh() {
    try { view = await get(); } catch { return; }
    render();
    if (view.active && !tick) tick = setInterval(() => { if (view.active && view.secondsLeft > 0) { view.secondsLeft--; $('interview-clock').textContent = `${clock(view.secondsLeft)} left`; } }, 1000);
    if (!view.active && tick) { clearInterval(tick); tick = null; }
  }

  async function act(url, body) {
    const r = await post(url, body);
    if (!r.ok) { oops(r.data.error || 'That did not work.'); return null; }
    oops(''); await refresh(); return r.data;
  }

  $('interview-start').onclick = () => { $('interview-notes').dataset.filled = ''; act('/api/sage/interview/start'); };
  $('interview-form').addEventListener('submit', async e => {
    e.preventDefault();
    const text = $('interview-text').value.trim(); if (!text) return;
    if (await act('/api/sage/interview/answer', { text })) $('interview-text').value = '';
  });
  $('interview-text').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('interview-form').requestSubmit(); } });
  $('interview-skip').onclick = () => act('/api/sage/interview/answer', { skip: true });
  $('interview-finish').onclick = () => { if (confirm('Finish the interview now? The Sage will write up what it has learned so far.')) act('/api/sage/interview/finish'); };
  $('interview-save').onclick = async () => {
    const notes = [...$('interview-notes').querySelectorAll('.iv-note')].map(f => ({ title: f.querySelector('input').value, text: f.querySelector('textarea').value }));
    const r = await act('/api/sage/interview/approve', { notes });
    if (r) { $('interview-notes').dataset.filled = ''; oops(r.failed.length ? `Saved ${r.saved.length}. Not saved: ${r.failed.map(f => `${f.title} (${f.error})`).join('; ')}` : ''); if (!r.failed.length) $('interview-done').hidden = false; }
  };
  $('interview-discard').onclick = async () => { if (confirm('Throw this draft away? Nothing from this interview will be kept.')) { $('interview-notes').dataset.filled = ''; await act('/api/sage/interview/discard'); } };
  $('interview-close').onclick = () => dlg.close();

  async function open() { $('interview-done').hidden = true; oops(''); await refresh(); if (!dlg.open) dlg.showModal(); if (view.active) $('interview-text').focus(); }
  // the Job log and the floor only say THAT something happened; the panel fetches what (it never goes through the event log)
  function onEvent(ev) { if (ev.type === 'sage.interview' || (ev.type === 'run.end' && ev.runId === view.runId)) refresh(); }
  return { open, onEvent };
}
