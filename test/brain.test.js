import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { makeBrain, kindFor } from '../src/brain/vault.js';
import { parseNote, formatNote, checkRel, pathFor, safeTitle, setLineLock, lockViolation, LINE_LOCK } from '../src/brain/notes.js';
import { makeSearch, tokenize } from '../src/brain/search.js';
import { hardlineRules, hardlineReason, checkPath } from '../src/safety/paths.js';
import { checkCommand } from '../src/safety/shell-guard.js';
import { validateSettings, brainPathProblem } from '../src/settings.js';

async function fresh() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mc-brain-'));
  let n = 0, t = Date.UTC(2026, 10, 7, 12, 0);
  const brain = makeBrain({ fsp, root, clock: { now: () => (t += 1000) }, newId: p => `${p}_${++n}` });
  assert.deepEqual(await brain.init(), { ok: true, created: true });
  return { brain, root };
}
const read = (root, rel) => fsp.readFile(path.join(root, rel), 'utf8');

test('notes: frontmatter round-trips and keeps keys a person added', () => {
  const meta = { title: 'Run tests first', kind: 'lesson', ape: 'smith', locked: true, uses: 3, tags: ['testing', 'node'], note: 'a: tricky "value"', mood: 'true' };
  const text = formatNote(meta, 'Body line\n');
  const back = parseNote(text);
  assert.deepEqual(back.meta, meta);
  assert.equal(back.body, 'Body line\n');
  assert.deepEqual(parseNote('no frontmatter here'), { meta: {}, body: 'no frontmatter here' });
  assert.deepEqual(parseNote('---\naliases:\n  - One\n  - Two\nempty:\n---\nx').meta, { aliases: ['One', 'Two'], empty: null });
});

test('notes: only safe places inside the Brain folders', () => {
  for (const bad of ['', '/etc/x.md', 'C:/x.md', '../x.md', 'Notes/../../x.md', 'Notes/.hidden.md', '.brain/journal.md', 'Notes/x.txt', 'Elsewhere/x.md', 'Notes/a:b.md', 'Notes/x#y.md', 'stray.md'])
    assert.ok(checkRel(bad, { write: true }), `${bad} should be refused`);
  for (const ok of ['Notes/Ports.md', 'You/Goals.md', 'Crew/smith/Lessons/Run tests first.md', 'Skills/smith/testing/SKILL.md', 'Proposals/p1.md'])
    assert.equal(checkRel(ok, { write: true }), null, ok);
  assert.equal(checkRel('Home.md'), null);
  assert.ok(checkRel('Home.md', { write: true }));
  assert.equal(safeTitle('  a/b: c?  '), 'a b c');
  assert.equal(safeTitle('...'), null);
  assert.deepEqual(pathFor({ kind: 'lesson', ape: 'smith', title: 'Use npm ci' }), { rel: 'Crew/smith/Lessons/Use npm ci.md' });
  assert.deepEqual(pathFor({ kind: 'skill', ape: 'smith', skill: 'testing' }), { rel: 'Skills/smith/testing/SKILL.md' });
  assert.ok(pathFor({ kind: 'lesson', title: 'x' }).error);
  assert.equal(kindFor('Crew/smith/smith.md'), 'note');
  assert.equal(kindFor('Crew/smith/Lessons/x.md'), 'lesson');
});

test('first run makes the vault: folders, Home and Log, and nothing else', async () => {
  const { brain, root } = await fresh();
  for (const d of ['You', 'Crew', 'Skills', 'Notes', 'Proposals', '.brain/archive']) assert.ok((await fsp.stat(path.join(root, d))).isDirectory(), d);
  assert.match(await read(root, 'Home.md'), /# The Brain/);
  const { notes } = await brain.list();
  assert.deepEqual(notes.map(n => n.rel), ['Home.md', 'Log.md']);
  // a second start changes nothing
  const again = makeBrain({ fsp, root, clock: { now: () => 1 }, newId: () => 'x' });
  assert.deepEqual(await again.init(), { ok: true, created: false });
});

test('write, change, undo and undo-of-create: every change is journaled and reversible', async () => {
  const { brain, root } = await fresh();
  const a = await brain.write({ rel: 'Notes/Ports.md', body: 'The app runs on 8787.\n', by: 'smith', sourceJob: 'run_1' });
  assert.equal(a.changeId, 'chg_1');
  let note = parseNote(await read(root, 'Notes/Ports.md'));
  assert.equal(note.meta.kind, 'note'); assert.equal(note.meta.source_job, 'run_1'); assert.equal(note.meta.title, 'Ports');
  const b = await brain.write({ rel: 'Notes/Ports.md', body: 'The app runs on 9000.\n', by: 'smith' });
  assert.match(await read(root, 'Notes/Ports.md'), /9000/);
  assert.equal((await brain.write({ rel: 'Notes/Ports.md', body: 'The app runs on 9000.\n', by: 'smith' })).unchanged, true);
  // undoing the older change first is refused: the note changed since
  assert.match((await brain.undo({ changeId: a.changeId, by: 'user' })).error, /changed after this/);
  assert.match((await brain.undo({ changeId: b.changeId, by: 'smith' })).error, /only the user/);
  assert.ok((await brain.undo({ changeId: b.changeId, by: 'user' })).changeId);
  assert.match(await read(root, 'Notes/Ports.md'), /8787/);
  assert.match((await brain.undo({ changeId: b.changeId, by: 'user' })).error, /already undone/);
  // undoing the create archives the note (nothing is deleted outright)
  assert.ok((await brain.undo({ changeId: a.changeId, by: 'user' })).changeId);
  await assert.rejects(read(root, 'Notes/Ports.md'));
  const { changes } = await brain.history();
  assert.deepEqual(changes.map(c => c.op), ['undo', 'undo', 'replace', 'create']);
  assert.equal(changes.find(c => c.id === a.changeId).undone, changes[0].id);
  const archived = await fsp.readdir(path.join(root, '.brain/archive', changes[0].id, 'Notes'));
  assert.deepEqual(archived, ['Ports.md']);
  assert.match(await read(root, 'Log.md'), /smith created \[\[Notes\/Ports\|Ports\]\] \(job run_1\)/);
});

test('archive moves a note aside, and undo brings it back', async () => {
  const { brain, root } = await fresh();
  await brain.write({ rel: 'Notes/Old.md', body: 'old\n', by: 'smith' });
  const r = await brain.archive({ rel: 'Notes/Old.md', by: 'user' });
  await assert.rejects(read(root, 'Notes/Old.md'));
  assert.equal((await brain.list()).notes.some(n => n.rel === 'Notes/Old.md'), false);
  await brain.undo({ changeId: r.changeId, by: 'user' });
  assert.match(await read(root, 'Notes/Old.md'), /old/);
  assert.ok((await brain.list()).notes.some(n => n.rel === 'Notes/Old.md'));
});

test('locks: a locked note or line can only be changed by the user', async () => {
  const { brain, root } = await fresh();
  await brain.write({ rel: 'You/Goals.md', body: 'Ship MonkeyCraft\nLearn piano\n', by: 'sage' });
  // the crew can't lock things themselves
  assert.match((await brain.write({ rel: 'You/Goals.md', meta: { locked: true }, body: 'x\n', by: 'sage' })).error, /only the user/);
  assert.match((await brain.write({ rel: 'Notes/New.md', body: `mine ${LINE_LOCK}\n`, by: 'sage' })).error, /only the user/);
  // line lock
  assert.ok((await brain.lock({ rel: 'You/Goals.md', line: 1, locked: true })).changeId);
  assert.match(await read(root, 'You/Goals.md'), /Learn piano %%locked%%/);
  assert.match((await brain.write({ rel: 'You/Goals.md', body: 'Ship MonkeyCraft\nLearn guitar\n', by: 'sage' })).error, /locked/);
  assert.ok((await brain.write({ rel: 'You/Goals.md', body: 'Ship MonkeyCraft 2\nLearn piano %%locked%%\n', by: 'sage' })).changeId);
  assert.match((await brain.archive({ rel: 'You/Goals.md', by: 'sage' })).error, /locked/);
  // whole-note lock
  await brain.lock({ rel: 'You/Goals.md', line: 1, locked: false });
  await brain.lock({ rel: 'You/Goals.md', locked: true });
  assert.equal(parseNote(await read(root, 'You/Goals.md')).meta.locked, true);
  assert.match((await brain.write({ rel: 'You/Goals.md', body: 'anything\n', by: 'sage' })).error, /locked by the user/);
  assert.match((await brain.archive({ rel: 'You/Goals.md', by: 'sage' })).error, /locked/);
  assert.ok((await brain.write({ rel: 'You/Goals.md', body: 'the user may\n', by: 'user' })).changeId);
  await brain.lock({ rel: 'You/Goals.md', locked: false });
  assert.equal(parseNote(await read(root, 'You/Goals.md')).meta.locked, undefined);
  assert.ok(setLineLock('a\n\nb', 1, true).error);
  assert.equal(lockViolation('---\nlocked: true\n---\nx', '---\n---\ny'), 'this note is locked by the user');
});

test('the Brain refuses its own files, other folders and symlinks out', async () => {
  const { brain, root } = await fresh();
  assert.match((await brain.write({ rel: 'Home.md', body: 'x', by: 'smith' })).error, /kept by MonkeyCraft/);
  assert.ok((await brain.write({ rel: '../escape.md', body: 'x', by: 'smith' })).error);
  const outside = await fsp.mkdtemp(path.join(os.tmpdir(), 'mc-out-'));
  await fsp.symlink(outside, path.join(root, 'Notes', 'link'));
  assert.match((await brain.write({ rel: 'Notes/link/x.md', body: 'x', by: 'smith' })).error, /outside the Brain/);
  assert.deepEqual(await fsp.readdir(outside), []);
  assert.deepEqual(await fsp.readdir(path.join(root, '.brain')).then(n => n.sort()), ['archive', 'undo']);   // refused writes leave no journal entry
});

test('crash safety: a journal line whose change never landed is harmless', async () => {
  const { brain, root } = await fresh();
  const a = await brain.write({ rel: 'Notes/A.md', body: 'one\n', by: 'smith' });
  // simulate a crash between "journal" and "write": an entry for a change that isn't in the note
  await fsp.appendFile(path.join(root, '.brain/journal.ndjson'), JSON.stringify({ id: 'chg_ghost', ts: 1, by: 'smith', op: 'replace', rel: 'Notes/A.md', beforeSha: 'x', afterSha: 'never-written' }) + '\n{"torn":');
  const again = makeBrain({ fsp, root, clock: { now: () => 5 }, newId: p => `${p}_after` });
  assert.equal((await again.init()).ok, true);
  assert.match((await again.undo({ changeId: 'chg_ghost', by: 'user' })).error, /changed after this/);
  assert.match(await read(root, 'Notes/A.md'), /one/);
  assert.ok((await again.undo({ changeId: a.changeId, by: 'user' })).changeId);   // the real change still undoes
  // no temp files are left beside notes
  assert.deepEqual((await fsp.readdir(path.join(root, 'Notes'))).filter(n => n.includes('.tmp-')), []);
});

test('edits made in Obsidian are picked up by the index', async () => {
  const { brain, root } = await fresh();
  await fsp.writeFile(path.join(root, 'Notes', 'Typed by hand.md'), 'The printer lives in the study.\n');
  const { hits } = await brain.search({ q: 'printer' });
  assert.equal(hits[0].rel, 'Notes/Typed by hand.md');
  await fsp.rm(path.join(root, 'Notes', 'Typed by hand.md'));
  assert.deepEqual((await brain.search({ q: 'printer' })).hits, []);
});

test('search: BM25 ranks title matches first, skips folders on request', async () => {
  assert.deepEqual(tokenize('The Café, and 8787 ports!'), ['cafe', '8787', 'ports']);
  const s = makeSearch();
  s.update('Notes/Ports.md', { title: 'Ports', body: 'MonkeyCraft listens on 8787.' }, { title: 'Ports' });
  s.update('Notes/Misc.md', { title: 'Misc', body: 'Ports ports everywhere, but this note is long and about many other things too, like trees and apes and rivers.' }, { title: 'Misc' });
  s.update('You/Goals.md', { title: 'Goals', body: 'Open ports for the home server.' }, { title: 'Goals' });
  const hits = s.query('ports');
  assert.equal(hits[0].rel, 'Notes/Ports.md');
  assert.equal(hits.length, 3);
  assert.ok(!s.query('ports', { skip: r => r.startsWith('You/') }).some(h => h.rel.startsWith('You/')));
  assert.deepEqual(s.query('the and'), []);
  s.remove('Notes/Ports.md');
  assert.equal(s.query('8787').length, 0);
  assert.match(s.query('rivers')[0].snippet, /rivers/);
});

test('hardline: the Brain is blocked for ordinary tools, case-insensitively on Windows drives', async () => {
  const home = '/home/u', dataDir = '/home/u/monkeycraft/data';
  const win = hardlineRules({ home, dataDir, brainDir: '/mnt/c/Users/Hayde/MonkeyCraftBrain' });
  for (const p of ['/mnt/c/Users/Hayde/MonkeyCraftBrain', '/mnt/c/Users/Hayde/MonkeyCraftBrain/You/Goals.md', '/mnt/c/users/hayde/monkeycraftbrain/.brain/journal.ndjson'])
    assert.match(hardlineReason(p, win), /the Brain/, p);
  assert.equal(hardlineReason('/mnt/c/Users/Hayde/MonkeyCraftBrainstorm/x.md', win), null);
  assert.equal(hardlineReason('/mnt/c/Users/Hayde/Documents/a.md', win), null);
  const linux = hardlineRules({ home, dataDir, brainDir: '/home/u/MonkeyCraftBrain' });
  assert.match(hardlineReason('/home/u/MonkeyCraftBrain/Notes/x.md', linux), /the Brain/);
  // a real symlink into the Brain is caught too
  const { root } = await fresh();
  const ws = await fsp.mkdtemp(path.join(os.tmpdir(), 'mc-ws-'));
  await fsp.symlink(root, path.join(ws, 'sneaky'));
  const rules = hardlineRules({ home: '/nonexistent', dataDir: '/nonexistent/data', brainDir: await fsp.realpath(root) });
  const c = await checkPath('sneaky/You/Goals.md', { home: '/nonexistent', workspace: await fsp.realpath(ws), rules, realpath: p => fsp.realpath(p) });
  assert.match(c.hardline, /the Brain/);
  // shell commands that name the Brain, in any spelling, are refused
  const extra = ['/mnt/c/Users/Hayde/MonkeyCraftBrain', 'c:\\Users\\Hayde\\MonkeyCraftBrain', 'c:/Users/Hayde/MonkeyCraftBrain', 'MonkeyCraftBrain'];
  for (const cmd of ['cat /mnt/c/users/hayde/monkeycraftbrain/You/Goals.md', 'type C:\\Users\\Hayde\\MonkeyCraftBrain\\Log.md', 'cd .. && ls MonkeyCraftBrain'])
    assert.equal(checkCommand(cmd, { extra }).ok, false, cmd);
  assert.equal(checkCommand('ls ~/Documents', { extra }).ok, true);
});

test('settings: the Brain folder must stay on this computer and away from the workspace', () => {
  for (const [p, re] of [['/mnt/c/Users/h/OneDrive/Desktop/Brain', /cloud-synced/], ['/mnt/c/Users/h/OneDrive - Work/Brain', /cloud-synced/], ['/mnt/c/Users/h/Dropbox/B', /cloud-synced/],
    ['relative/brain', /full path/], ['/etc/brain', /system folder/], ['/mnt/c', /system folder/], ['/home/u/ws/brain', /workspace/], ['/home/u', /workspace/], ['', /empty/]])
    assert.match(brainPathProblem(p, { workspace: '/home/u/ws', dataDir: '/home/u/mc/data' }), re, p);
  assert.equal(brainPathProblem('/mnt/c/Users/h/MonkeyCraftBrain', { workspace: '/home/u/ws' }), null);
  const r = validateSettings({ brain: { path: '/mnt/c/Users/h/MonkeyCraftBrain/' } }, { crewIds: [] });
  assert.deepEqual(r, { ok: true, value: { crew: {}, limits: {}, brain: { path: '/mnt/c/Users/h/MonkeyCraftBrain' } } });
  assert.equal(validateSettings({ brain: { path: '/mnt/c/Users/h/OneDrive/x' } }, { crewIds: [] }).ok, false);
  assert.deepEqual(validateSettings({}, { crewIds: [] }), { ok: true, value: { crew: {}, limits: {} } });
});
