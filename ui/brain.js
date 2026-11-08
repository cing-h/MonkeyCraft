// The Brain panel: browse and search the village's memory, read a note, lock a
// note or one line so the crew can't change it, archive a note, and undo any
// change from the history. Everything here acts as the user, through /api/brain.

export function initBrain({ $, el, post }) {
  const dlg = $('brain-dialog');
  let current = null, query = '', timer = null;
  const LABEL = { profile: 'about you', lesson: 'lesson', skill: 'skill', note: 'note', proposal: 'proposal', system: 'MonkeyCraft' };
  const OP = { create: 'made', replace: 'changed', archive: 'archived', undo: 'undid a change to' };
  const when = ts => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  function oops(msg) { const e = $('brain-error'); e.textContent = msg || ''; e.hidden = !msg; }
  const get = url => fetch(url).then(async r => ({ ok: r.ok, data: await r.json().catch(() => ({})) }));

  async function loadList() {
    const res = query ? await get(`/api/brain/search?q=${encodeURIComponent(query)}`) : await get('/api/brain/notes');
    if (!res.ok) return oops(res.data.error || 'The Brain could not be read.');
    const items = query ? res.data.hits : res.data.notes, ul = document.createDocumentFragment();
    if (!items.length) ul.append(el('li', 'brain-empty', query ? 'Nothing matches.' : 'Empty so far.'));
    let folder = null;
    for (const n of items) {
      const f = n.rel.includes('/') ? n.rel.split('/').slice(0, -1).join(' / ') : 'Brain';
      if (!query && f !== folder) { folder = f; ul.append(el('li', 'brain-folder', f)); }
      const li = el('li'), b = el('button', 'brain-item');
      b.type = 'button'; b.setAttribute('aria-current', String(current === n.rel));
      b.append(el('span', '', n.title || n.rel), el('small', '', [LABEL[n.kind] || n.kind, n.locked ? 'locked' : '', n.lockedLines ? `${n.lockedLines} locked line${n.lockedLines > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')));
      if (query && n.snippet) b.append(el('small', 'brain-snip', n.snippet));
      b.onclick = () => openNote(n.rel);
      li.append(b); ul.append(li);
    }
    $('brain-notes').replaceChildren(ul);   // swapped in whole, so the list never flickers empty
  }

  async function openNote(rel) {
    current = rel; oops('');
    const box = $('brain-note'); box.replaceChildren();
    const res = await get(`/api/brain/note?path=${encodeURIComponent(rel)}`);
    if (!res.ok) { box.append(el('p', 'hint', res.data.error || 'That note could not be read.')); return loadList(); }
    const n = res.data, m = n.meta, system = n.kind === 'system';
    box.append(el('h3', '', n.title), el('p', 'brain-path', n.rel));
    const facts = [LABEL[n.kind] || n.kind, m.ape && `ape: ${m.ape}`, m.source_job && `from job ${m.source_job}`, m.updated && `updated ${when(m.updated)}`, m.tainted && 'came from a job that read the web'].filter(Boolean);
    box.append(el('p', 'hint', facts.join(' · ')));
    if (!system) {
      const btns = el('div', 'brain-btns');
      const lock = el('button', m.locked ? 'primary' : '', m.locked ? 'Unlock note' : 'Lock note');
      lock.type = 'button'; lock.title = m.locked ? 'Let the crew change this note again' : 'Stop the crew changing this note (you still can)';
      lock.onclick = () => act('/api/brain/lock', { path: rel, locked: !m.locked });
      const arch = el('button', '', 'Archive');
      arch.type = 'button'; arch.title = 'Move this note out of the Brain. You can bring it back from History.';
      arch.onclick = async () => { if (confirm(`Archive "${n.title}"? You can bring it back from History.`)) { const r = await act('/api/brain/archive', { path: rel }); if (r) { current = null; box.replaceChildren(el('p', 'hint', 'Archived. Undo it from History.')); } } };
      btns.append(lock, arch); box.append(btns);
    }
    const ol = el('ol', 'brain-lines'); ol.setAttribute('aria-label', 'The note, line by line');
    n.body.replace(/\n$/, '').split('\n').forEach((line, i) => {
      const li = el('li'), locked = /%%locked%%\s*$/.test(line);
      li.append(el('span', 'brain-text', line.replace(/\s*%%locked%%\s*$/, '') || ' '));
      if (!system && line.trim() && !m.locked) {
        const b = el('button', 'brain-lock', locked ? '🔒' : '🔓');
        b.type = 'button'; b.setAttribute('aria-pressed', String(locked));
        b.setAttribute('aria-label', `${locked ? 'Unlock' : 'Lock'} line ${i + 1}`); b.title = locked ? 'Locked: the crew can\'t change this line' : 'Lock this line';
        b.onclick = () => act('/api/brain/lock', { path: rel, line: i, locked: !locked });
        li.append(b);
      }
      if (locked) li.classList.add('locked');
      ol.append(li);
    });
    box.append(ol);
    loadList();
  }

  async function act(url, body) {
    const r = await post(url, body);
    if (!r.ok) { oops(r.data.error || 'That did not work.'); return null; }
    oops('');
    if (current) await openNote(current); else await loadList();
    if (!$('brain-history').hidden) await loadHistory();
    return r.data;
  }

  async function loadHistory() {
    const ol = $('brain-changes'); ol.replaceChildren();
    const res = await get('/api/brain/history');
    if (!res.ok) return oops(res.data.error || 'The history could not be read.');
    if (!res.data.changes.length) { ol.append(el('li', 'brain-empty', 'No changes yet.')); return; }
    for (const c of res.data.changes) {
      const li = el('li');
      li.append(el('span', 'brain-when', when(c.ts)), el('span', '', `${c.by === 'user' ? 'You' : c.by} ${OP[c.op] || c.op} ${c.rel}${c.sourceJob ? ` (job ${c.sourceJob})` : ''}`));
      if (c.undone) li.append(el('small', 'hint', 'undone'));
      else if (c.op !== 'undo') {
        const b = el('button', '', 'Undo'); b.type = 'button';
        b.onclick = () => act('/api/brain/undo', { changeId: c.id });
        li.append(b);
      }
      ol.append(li);
    }
  }

  function tab(which) {
    for (const b of dlg.querySelectorAll('[role="tab"]')) b.setAttribute('aria-selected', String(b.dataset.tab === which));
    $('brain-browse').hidden = which !== 'notes'; $('brain-history').hidden = which !== 'history';
    if (which === 'history') loadHistory();
  }

  async function open(rel = null) {
    const s = await get('/api/brain');
    $('brain-where').textContent = s.data.ready ? `${s.data.root} · ${s.data.notes} notes · open this folder in Obsidian to read it there` : `The Brain isn't available${s.data.error ? ` (${s.data.error})` : ''}.`;
    oops(''); tab('notes'); await loadList();
    if (!dlg.open) dlg.showModal();
    if (rel) await openNote(rel);
  }

  $('open-brain').onclick = () => open(current).catch(e => alert('Could not open the Brain: ' + e.message));
  $('brain-close').onclick = () => dlg.close();
  for (const b of dlg.querySelectorAll('[role="tab"]')) b.onclick = () => tab(b.dataset.tab);
  $('brain-search').addEventListener('input', e => { clearTimeout(timer); timer = setTimeout(() => { query = e.target.value.trim(); loadList(); }, 200); });
  return { open };
}
