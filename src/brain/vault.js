// The Brain: the village's own Obsidian vault, where the crew remember what they
// learn and what they know about the user. It's the ONLY module that writes there.
//
//   - every change is journaled first and can be undone (src/brain/journal.js)
//   - removal only ever archives, into .brain/archive/
//   - a note or line the user locked can't be changed by anyone but the user
//   - writes go temp file → fsync → rename, so a crash never leaves half a note
//   - changes are made one at a time, in order
//
// The user may also edit notes in Obsidian; the index picks those up, and undo
// refuses to overwrite a note that changed since (its hash no longer matches).
//
// Injected IO only (fsp with realpath, clock, newId).

import path from 'node:path';
import { writeFileDurable, appendDurable } from '../store/durable.js';
import { makeBrainJournal } from './journal.js';
import { makeSearch } from './search.js';
import {
  AREAS, SYSTEM_NOTES, checkRel, parseNote, formatNote, sha256, titleOf, lockViolation, lockedLines, setLineLock
} from './notes.js';

const MAX_NOTES = 5000, MAX_NOTE_BYTES = 200_000;

const HOME = `# The Brain

The MonkeyCraft village's shared memory. The crew read it before a job and learn into it after one.
MonkeyCraft keeps it, and every change it makes can be undone from the Brain panel.

- **You/**: who you are, your goals and how you like to work
- **Crew/**: each ape's notes and lessons
- **Skills/**: how each ape does its work (SKILL.md files)
- **Notes/**: what the crew know about your projects and computer
- **Proposals/**: changes waiting for you at the council
- [[Log]]: what was learned, when and from which job

You can edit any note here. To stop the crew changing a note, lock it in the Brain panel
(or set \`locked: true\` at the top). To protect one line, end it with \`%%locked%%\`.
`;
const LOG = '# Log\n\nWhat the Brain learned, newest last.\n\n';

/** The kind a note must be, from where it lives. */
export function kindFor(rel) {
  const s = rel.split('/');
  if (s[0] === 'You') return 'profile';
  if (s[0] === 'Notes') return 'note';
  if (s[0] === 'Proposals') return 'proposal';
  if (s[0] === 'Skills') return 'skill';
  if (s[0] === 'Crew') return s[2] === 'Lessons' ? 'lesson' : 'note';
  return 'system';
}
// Home and Log first, then the folders in AREAS order (You, Crew, Skills, Notes, Proposals)
const areaRank = rel => rel.includes('/') ? 1 + AREAS.indexOf(rel.split('/')[0]) : 0;
const apeFor = rel => (rel.startsWith('Crew/') || rel.startsWith('Skills/')) ? rel.split('/')[1] : null;

export function makeBrain({ fsp, root, clock, newId }) {
  const meta = path.join(root, '.brain');
  const journal = makeBrainJournal({ fsp, dir: meta });
  const search = makeSearch();
  const seen = new Map();   // rel -> { mtimeMs, size, info }
  let realRoot = null, ready = false, initError = null, chain = Promise.resolve();

  const serial = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
  const iso = () => new Date(clock.now()).toISOString();
  const abs = rel => path.join(root, ...rel.split('/'));
  const linkTo = rel => `[[${rel.replace(/\.md$/, '')}|${titleOf(rel) === 'SKILL' ? rel.split('/').slice(-2, -1)[0] : titleOf(rel)}]]`;

  async function readText(rel) {
    try { return await fsp.readFile(abs(rel), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }

  /** The note's real folder must be inside the Brain (no symlink out). Makes the folders. */
  async function place(rel) {
    const dir = path.dirname(abs(rel));
    await fsp.mkdir(dir, { recursive: true });
    const real = await fsp.realpath(dir);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw Object.assign(new Error('that folder leads outside the Brain'), { code: 'OUTSIDE' });
    return abs(rel);
  }

  function indexNote(rel, text, st) {
    const { meta: m, body } = parseNote(text);
    const info = { title: typeof m.title === 'string' && m.title ? m.title : titleOf(rel), kind: kindFor(rel), ape: apeFor(rel), locked: m.locked === true, lockedLines: lockedLines(body).length, tainted: m.tainted === true, updated: m.updated ?? null };
    search.update(rel, { title: info.title, meta: m, body }, info);
    seen.set(rel, { mtimeMs: st?.mtimeMs ?? 0, size: st?.size ?? text.length, info });
  }

  /** Pick up notes added, changed or removed outside MonkeyCraft (for example in Obsidian). */
  async function refresh() {
    const found = new Set();
    const walk = async (dirRel, depth) => {
      if (depth > 8 || found.size >= MAX_NOTES) return;
      let names = [];
      try { names = await fsp.readdir(dirRel ? abs(dirRel) : root, { withFileTypes: true }); } catch { return; }
      for (const d of names) {
        if (d.name.startsWith('.')) continue;
        const rel = dirRel ? `${dirRel}/${d.name}` : d.name;
        if (d.isDirectory()) { if (dirRel || AREAS.includes(d.name)) await walk(rel, depth + 1); continue; }
        if (!d.isFile() || checkRel(rel)) continue;
        found.add(rel);
        let st; try { st = await fsp.stat(abs(rel)); } catch { continue; }
        const was = seen.get(rel);
        if (was && was.mtimeMs === st.mtimeMs && was.size === st.size) continue;
        if (st.size > MAX_NOTE_BYTES) continue;
        const text = await readText(rel); if (text !== null) indexNote(rel, text, st);
      }
    };
    await walk('', 0);
    for (const rel of [...seen.keys()]) if (!found.has(rel)) { seen.delete(rel); search.remove(rel); }
  }

  async function log(line) { await appendDurable(fsp, abs('Log.md'), `- ${iso().slice(0, 16).replace('T', ' ')} · ${line}\n`); }

  async function landed(rel) { let st = null; try { st = await fsp.stat(abs(rel)); } catch {} const t = await readText(rel); if (t === null) { seen.delete(rel); search.remove(rel); } else indexNote(rel, t, st); }

  /** Create or replace a note. Returns { changeId, rel, unchanged? } or { error }. */
  async function doWrite({ rel, meta: m = {}, body = '', by, sourceJob = null, tainted = false }) {
    const bad = checkRel(rel, { write: true }); if (bad) return { error: bad };
    if (typeof by !== 'string' || !by) return { error: 'who is writing must be named' };
    if (typeof body !== 'string') return { error: 'the note body must be text' };
    const prevText = await readText(rel), prev = prevText === null ? null : parseNote(prevText);
    const now = iso();
    const next = {
      ...(prev?.meta || {}), ...m,
      title: (typeof m.title === 'string' && m.title.trim()) || prev?.meta.title || titleOf(rel),
      kind: kindFor(rel), created: prev?.meta.created || now, updated: now
    };
    const ape = apeFor(rel); if (ape) next.ape = ape; else delete next.ape;
    if (sourceJob) next.source_job = sourceJob;
    if (tainted) next.tainted = true;
    if (next.locked !== true) delete next.locked;
    if (next.tainted !== true) delete next.tainted;
    const text = formatNote(next, body);
    if (Buffer.byteLength(text) > MAX_NOTE_BYTES) return { error: `a note can be at most ${MAX_NOTE_BYTES / 1000} kB` };
    if (by !== 'user') {
      const why = prevText === null ? (next.locked === true || lockedLines(body).length ? 'only the user can lock a note or a line' : null) : lockViolation(prevText, text);
      if (why) return { error: why };
    }
    if (prevText !== null && parseNote(prevText).body === parseNote(text).body && sameMeta(prev.meta, next)) return { rel, changeId: null, unchanged: true };
    const id = newId('chg'), dest = await place(rel);
    if (prevText !== null) await journal.saveSnapshot(id, prevText);
    await journal.add({ id, ts: clock.now(), by, sourceJob, op: prevText === null ? 'create' : 'replace', rel, beforeSha: prevText === null ? null : sha256(prevText), afterSha: sha256(text) });
    await writeFileDurable(fsp, dest, text);
    await landed(rel);
    await log(`${by} ${prevText === null ? 'created' : 'changed'} ${linkTo(rel)}${sourceJob ? ` (job ${sourceJob})` : ''}`);
    return { rel, changeId: id };
  }
  const sameMeta = (a, b) => { const strip = o => JSON.stringify(Object.entries(o).filter(([k]) => k !== 'updated').sort()); return strip(a) === strip(b); };

  /** Move a note into .brain/archive/. Nothing in the Brain is ever deleted outright. */
  async function doArchive({ rel, by }) {
    const bad = checkRel(rel, { write: true }); if (bad) return { error: bad };
    const text = await readText(rel); if (text === null) return { error: 'no such note' };
    if (by !== 'user') { const { meta: m, body } = parseNote(text); if (m.locked === true || lockedLines(body).length) return { error: 'this note is locked by the user' }; }
    const id = newId('chg'), archivedTo = `archive/${id}/${rel}`;
    await journal.add({ id, ts: clock.now(), by, sourceJob: null, op: 'archive', rel, beforeSha: sha256(text), afterSha: null, archivedTo });
    const dest = path.join(meta, ...archivedTo.split('/'));
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.rename(abs(rel), dest);
    await landed(rel);
    await log(`${by} archived ${titleOf(rel)} (${rel})`);
    return { rel, changeId: id };
  }

  /** Put a note back as it was before change `changeId`. The undo is journaled too. */
  async function doUndo({ changeId, by }) {
    const e = journal.get(String(changeId || '')); if (!e) return { error: 'no such change' };
    if (by !== 'user') return { error: 'only the user can undo a change' };
    if (e.op === 'undo') return { error: 'an undo can\'t itself be undone; make the change again instead' };
    if (journal.undoneBy(e.id)) return { error: 'that change was already undone' };
    const cur = await readText(e.rel);
    const id = newId('chg');
    if (e.op === 'archive') {
      if (cur !== null) return { error: 'a note with that name exists again, so the archived one can\'t go back' };
      const dest = await place(e.rel);
      await journal.add({ id, ts: clock.now(), by, op: 'undo', undoes: e.id, rel: e.rel, beforeSha: null, afterSha: e.beforeSha });
      await fsp.rename(path.join(meta, ...e.archivedTo.split('/')), dest);
    } else {
      if (cur === null || sha256(cur) !== e.afterSha) return { error: 'the note changed after this, so undo the later change first (or edit it by hand)' };
      if (e.op === 'create') {
        const archivedTo = `archive/${id}/${e.rel}`;
        await journal.add({ id, ts: clock.now(), by, op: 'undo', undoes: e.id, rel: e.rel, beforeSha: e.afterSha, afterSha: null, archivedTo });
        const dest = path.join(meta, ...archivedTo.split('/'));
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.rename(abs(e.rel), dest);
      } else {
        const before = await journal.readSnapshot(e.id);
        const dest = await place(e.rel);
        await journal.saveSnapshot(id, cur);
        await journal.add({ id, ts: clock.now(), by, op: 'undo', undoes: e.id, rel: e.rel, beforeSha: e.afterSha, afterSha: sha256(before) });
        await writeFileDurable(fsp, dest, before);
      }
    }
    await landed(e.rel);
    await log(`${by} undid a change to ${titleOf(e.rel)} (${e.rel})`);
    return { rel: e.rel, changeId: id };
  }

  /** The user locks or unlocks a whole note, or one body line (0-based `line`). */
  async function doLock({ rel, locked, line }) {
    const bad = checkRel(rel, { write: true }); if (bad) return { error: bad };
    const text = await readText(rel); if (text === null) return { error: 'no such note' };
    const { meta: m, body } = parseNote(text);
    if (line === undefined || line === null) return doWrite({ rel, meta: { ...m, locked: !!locked }, body, by: 'user' });
    const r = setLineLock(body, line, !!locked); if (r.error) return r;
    return doWrite({ rel, meta: m, body: r.body, by: 'user' });
  }

  const guarded = fn => args => serial(async () => {
    if (!ready) return { error: initError ? `the Brain isn't available: ${initError}` : 'the Brain isn\'t ready yet' };
    try { return await fn(args || {}); } catch (e) { return { error: e.code === 'OUTSIDE' ? e.message : `the Brain couldn't do that: ${e.code || e.message}` }; }
  });

  return {
    root,
    /** Make the vault on first run (folders, Home, Log), load the journal and index every note. */
    init: () => serial(async () => {
      try {
        await fsp.mkdir(root, { recursive: true });
        realRoot = await fsp.realpath(root);
        for (const d of [...AREAS, '.brain/archive']) await fsp.mkdir(path.join(root, ...d.split('/')), { recursive: true });
        let created = false;
        for (const [rel, text] of [['Home.md', HOME], ['Log.md', LOG]]) if (await readText(rel) === null) { await writeFileDurable(fsp, abs(rel), text); created = true; }
        await journal.load();
        await refresh();
        ready = true; initError = null;
        return { ok: true, created };
      } catch (e) { ready = false; initError = e.code || e.message; return { ok: false, error: initError }; }
    }),
    status: () => ({ root, ready, error: initError, notes: seen.size, changes: journal.count() }),
    write: guarded(doWrite),
    archive: guarded(doArchive),
    undo: guarded(doUndo),
    lock: guarded(doLock),
    /** { rel, meta, body, sha, lines: [{ text, locked }] } or { error }. */
    read: guarded(async ({ rel }) => {
      const bad = checkRel(rel); if (bad) return { error: bad };
      const text = await readText(rel); if (text === null) return { error: 'no such note' };
      const { meta: m, body } = parseNote(text);
      return { rel, title: (typeof m.title === 'string' && m.title) || titleOf(rel), kind: kindFor(rel), meta: m, body, sha: sha256(text) };
    }),
    /** Every note's summary, Home and Log first, then by folder and path. `area` narrows it to one folder. */
    list: guarded(async ({ area } = {}) => {
      await refresh();
      const notes = [...seen.entries()].filter(([rel]) => !area || rel.startsWith(area + '/') || (area === 'Home' && SYSTEM_NOTES.includes(rel)))
        .map(([rel, s]) => ({ rel, ...s.info })).sort((a, b) => areaRank(a.rel) - areaRank(b.rel) || a.rel.localeCompare(b.rel));
      return { notes };
    }),
    /** BM25 search. `skipAreas` leaves whole folders out (the profile, for network agents). */
    search: guarded(async ({ q, limit = 10, skipAreas = [] }) => {
      await refresh();
      return { hits: search.query(String(q || ''), { limit, skip: rel => skipAreas.some(a => rel.startsWith(a + '/')) }) };
    }),
    history: guarded(async ({ limit = 50 } = {}) => ({ changes: journal.list(limit) }))
  };
}
