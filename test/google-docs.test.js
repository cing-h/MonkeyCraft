// The Clerk, phase 2: Google Docs (Markdown in and out, exact replace, backups
// before editing the user's own files) and the file picker's key and session.
// All of it against the simulated Google.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { memFs } from './helpers/memfs.js';
import { fakeGoogle } from './helpers/fake-google.js';
import { makeGoogleAuth } from '../src/google/auth.js';
import { makeGoogleApi } from '../src/google/api.js';
import { makeDrive, MIME } from '../src/google/drive.js';
import { makeDocs, parseMarkdown, parseInline, countOccurrences } from '../src/google/docs.js';
import { makeDocsTools } from '../src/tools/google-docs.js';
import { makeDriveTools } from '../src/tools/google-drive.js';
import { makeRegistry } from '../src/tools/registry.js';
import { makeUndoStore } from '../src/store/undo.js';

const NOW = Date.UTC(2026, 10, 6, 14, 30);
async function setup() {
  const g = fakeGoogle(), fs = memFs(), clock = { now: () => NOW };
  const auth = makeGoogleAuth({ fsp: fs, dir: '/data/google', fetchImpl: g.fetchImpl, clock, randomBytes, redirectUri: 'http://127.0.0.1:8787/api/google/callback' });
  const api = makeGoogleApi({ auth, fetchImpl: g.fetchImpl, sleep: async () => {} });
  const drive = makeDrive({ api }), docs = makeDocs({ api });
  let n = 0;
  const undo = makeUndoStore({ fsp: fs, dir: '/data/undo', newId: p => `${p}_${++n}`, clock });
  const tools = [...makeDriveTools({ auth, drive, undo }), ...makeDocsTools({ auth, drive, docs, undo, clock })];
  const reg = makeRegistry(tools);
  const prompts = [], events = [];
  const ctx = { emit: (type, p) => events.push({ type, ...p }), newId: p => `${p}_${++n}`, grants: new Set(tools.map(t => t.name)), interactive: true, runId: 'run_d1', consent: { request: async p => { prompts.push(p); return true; } } };
  await auth.saveClient(g.keyJson());
  await auth.finishConnect(g.consent(auth.startConnect().url));
  const call = (tool, args, c = ctx) => reg.dispatch({ tool, args }, c);
  const revert = (runId = 'run_d1') => undo.revert(runId, { guard: async () => null, remote: r => drive.revertChange(r) });
  const newestDoc = name => [...g.files.values()].filter(f => f.mimeType === MIME.doc && f.name === name).pop();
  return { g, auth, drive, docs, undo, call, ctx, prompts, events, revert, newestDoc };
}

const SAMPLE = `# Trip plan

A short **plan** for the *river* trip, see [the map](https://example.com/map).

## Packing
- tent
- \`stove\`

1. Leave at dawn
2. Camp by the falls

| Day | Where |
| --- | --- |
| 1 | River |
| 2 | Falls |

Back on Sunday.`;

// ---------- Markdown ----------
test('markdown: headings, lists, tables and inline styles become blocks', () => {
  const b = parseMarkdown(SAMPLE);
  assert.deepEqual(b.map(x => x.kind === 'table' ? 'table' : `${x.style}${x.list ? ':' + x.list : ''}`), [
    'HEADING_1', 'NORMAL_TEXT', 'HEADING_2', 'NORMAL_TEXT:bullet', 'NORMAL_TEXT:bullet', 'NORMAL_TEXT:number', 'NORMAL_TEXT:number', 'table', 'NORMAL_TEXT']);
  assert.equal(b[1].text, 'A short plan for the river trip, see the map.');
  assert.deepEqual(b[1].spans.map(s => Object.keys(s).find(k => !['start', 'end'].includes(k))), ['bold', 'italic', 'link']);
  assert.deepEqual(b[7].rows.map(r => r.map(c => c.text)), [['Day', 'Where'], ['1', 'River'], ['2', 'Falls']]);
  assert.deepEqual(parseInline('**a *b* c**').spans.map(s => [s.start, s.end, !!s.bold, !!s.italic]), [[0, 5, true, false], [2, 3, false, true]]);
  assert.equal(parseInline('2 * 3 * 4').text, '2 * 3 * 4', 'lone stars are not italics');
  assert.equal(parseInline('snake_case_name').text, 'snake_case_name');
  assert.equal(countOccurrences('aaaa', 'aa'), 2);
});

// ---------- create + read ----------
test('docs.create: writes real formatting and reads back as the same Markdown', async () => {
  const s = await setup();
  const r = await s.call('docs.create', { title: 'Trip plan', content: SAMPLE });
  assert.equal(r.ok, true, r.content);
  assert.match(s.prompts[0].summary, /^make a Google Doc "Trip plan" at the top of My Drive \(9 blocks, 2 headings, 1 table\)/);
  const f = s.newestDoc('Trip plan');
  const md = (await s.call('docs.read', { fileId: f.id })).content;
  for (const want of ['# Trip plan', '## Packing', '- tent', '- stove', '1. Leave at dawn', '1. Camp by the falls', '| Day | Where |', '| 2 | Falls |', 'Back on Sunday.'])
    assert.ok(md.includes(want), `missing ${want}\n${md}`);
  const t = f.doc.tokens.filter(x => typeof x === 'object');
  const styleOf = word => { const txt = t.map(x => x.ch).join(''), i = txt.indexOf(word); return t[i].ts; };
  assert.equal(styleOf('plan for').bold, true);
  assert.equal(styleOf('river').italic, true);
  assert.equal(styleOf('the map').link.url, 'https://example.com/map');
  assert.equal(styleOf('Day').bold, true, 'the header row is bold');
  assert.equal(styleOf('River').bold, undefined);
  assert.equal(styleOf('Back on').bold, undefined, 'nothing leaks past a styled span');
});

test('docs.append: added text never inherits the heading or list it follows', async () => {
  const s = await setup();
  await s.call('docs.create', { title: 'N', content: '# Big title' });
  const f = s.newestDoc('N');
  await s.call('docs.append', { fileId: f.id, content: 'plain words' });
  await s.call('docs.append', { fileId: f.id, content: '- one\n- two' });
  await s.call('docs.append', { fileId: f.id, content: 'after the list' });
  const md = (await s.call('docs.read', { fileId: f.id })).content.split('\n\n').slice(1).join('\n\n');
  assert.equal(md, '# Big title\nplain words\n- one\n- two\nafter the list');
});

test('docs.create: inside a folder; refuses a non-folder, an empty title and when not connected', async () => {
  const s = await setup();
  await s.call('drive.folder', { name: 'Box' });
  const box = [...s.g.files.values()].find(f => f.name === 'Box');
  assert.equal((await s.call('docs.create', { title: 'In box', content: 'hi', folderId: box.id })).ok, true);
  assert.deepEqual(s.newestDoc('In box').parents, [box.id]);
  assert.match(s.prompts.at(-1).summary, /in folder "Box"/);
  const doc = s.newestDoc('In box');
  assert.match((await s.call('docs.create', { title: 'X', content: 'hi', folderId: doc.id })).content, /isn't a folder/);
  assert.match((await s.call('docs.create', { title: '  ', content: 'hi' })).content, /needs a title/);
  await s.auth.disconnect();
  assert.match((await s.call('docs.create', { title: 'X', content: 'hi' })).content, /Connect Google/);
});

test('docs.create: if writing stops part-way, the job is told and Revert still bins the Doc', async () => {
  const s2 = await setup();
  const md = 'one\n\n| a | b |\n|---|---|\n| 1 | 2 |';
  const real = s2.g.fetch.bind(s2.g); let batches = 0;
  s2.g.fetch = (u, o) => { if (String(u).includes(':batchUpdate') && ++batches === 2) s2.g.failNext(500); return real(u, o); };
  const r = await s2.call('docs.create', { title: 'Half', content: md });
  assert.equal(r.ok, false); assert.match(r.content, /was made .* but writing into it stopped part-way/);
  const out = await s2.revert();
  assert.equal(out.find(o => o.path.includes('Half')).result, 'binned');
});

// ---------- editing the user's own Docs: backups ----------
test('editing a Doc the job did not make: one backup copy first, then the edit; Revert points to the backup', async () => {
  const s = await setup();
  const mine = s.g.addFile({ name: 'Letter', mimeType: MIME.doc, visible: false, text: 'Dear Sam,\nSee you soon.' });
  assert.equal((await s.call('docs.read', { fileId: mine.id })).ok, false, 'hidden until the user picks it');
  s.g.pick(mine.id);
  const r1 = await s.call('docs.append', { fileId: mine.id, content: 'P.S. bring snacks' });
  assert.equal(r1.ok, true, r1.content);
  assert.match(s.prompts.at(-1).summary, /a backup copy is saved in Drive first/);
  const backups = () => [...s.g.files.values()].filter(f => f.name.startsWith('Letter (backup before MonkeyCraft, 2026-11-06 14:30)'));
  assert.equal(backups().length, 1);
  assert.doesNotMatch(backups()[0].doc.tokens.map(t => t.ch).join(''), /snacks/, 'the backup is from before');
  await s.call('docs.replace', { fileId: mine.id, find: 'Sam', replaceWith: 'Alex' });
  assert.equal(backups().length, 1, 'one backup per document per job');
  assert.doesNotMatch(s.prompts.at(-1).summary, /backup/);
  const out = await s.revert();
  const edit = out.find(o => o.path === 'Google Drive: edited "Letter"');
  assert.match(edit.result, /^skipped: Google can't undo edits .* "Letter \(backup before MonkeyCraft/);
  assert.equal(s.g.files.get(backups()[0].id).trashed, false, 'Revert never bins the backup');
  // a new job backs up again
  await s.call('docs.append', { fileId: mine.id, content: 'more' }, { ...s.ctx, runId: 'run_d2' });
  assert.equal(backups().length, 2);
});

test('a Doc made in the same job is edited without a backup (Revert bins it anyway)', async () => {
  const s = await setup();
  await s.call('docs.create', { title: 'Fresh', content: 'hello' });
  const f = s.newestDoc('Fresh');
  await s.call('docs.append', { fileId: f.id, content: 'world' });
  await s.call('docs.replace', { fileId: f.id, find: 'hello', replaceWith: 'hi' });
  assert.equal([...s.g.files.values()].some(x => x.name.includes('backup')), false);
  const out = await s.revert();
  assert.equal(out.find(o => o.result === 'binned').path, 'Google Drive: new Doc "Fresh"');
});

// ---------- exact replace ----------
test('docs.replace: exact and checked: not found, the wrong count and line breaks change nothing', async () => {
  const s = await setup();
  await s.call('docs.create', { title: 'R', content: 'cat and cat\n\nA Cat here' });
  const f = s.newestDoc('R'), before = s.g.docRequests.length;
  assert.match((await s.call('docs.replace', { fileId: f.id, find: 'dog', replaceWith: 'x' })).content, /isn't in/);
  assert.match((await s.call('docs.replace', { fileId: f.id, find: 'cat', replaceWith: 'x' })).content, /2 times, not 1/);
  assert.match((await s.call('docs.replace', { fileId: f.id, find: 'cat\nA', replaceWith: 'x' })).content, /line break/);
  assert.match((await s.call('docs.replace', { fileId: f.id, find: 'cat', replaceWith: 'cat' })).content, /same as/);
  assert.equal(s.g.docRequests.length, before, 'nothing was sent');
  const r = await s.call('docs.replace', { fileId: f.id, find: 'cat', replaceWith: 'dog', count: 2 });
  assert.equal(r.ok, true); assert.match(r.content, /Replaced 2 place/);
  assert.match(s.prompts.at(-1).summary, /replace \(2 places\)\n {2}"cat"\n {2}→ "dog"/);
  assert.match((await s.call('docs.read', { fileId: f.id })).content, /dog and dog\nA Cat here/);
});

test('docs tools refuse non-Docs and binned Docs', async () => {
  const s = await setup();
  await s.call('drive.folder', { name: 'F' });
  const folder = [...s.g.files.values()].find(f => f.name === 'F');
  assert.match((await s.call('docs.append', { fileId: folder.id, content: 'x' })).content, /isn't a Google Doc/);
  await s.call('docs.create', { title: 'B', content: 'x' });
  const b = s.newestDoc('B'); await s.call('drive.bin', { fileId: b.id });
  assert.match((await s.call('docs.append', { fileId: b.id, content: 'x' })).content, /in the bin/);
});

test('every Docs change asks first, every time, and is never remembered', async () => {
  const s = await setup();
  await s.call('docs.create', { title: 'A', content: 'x' });
  const f = s.newestDoc('A');
  await s.call('docs.append', { fileId: f.id, content: 'y' }); await s.call('docs.append', { fileId: f.id, content: 'z' });
  await s.call('docs.read', { fileId: f.id });
  assert.equal(s.prompts.length, 3);
  assert.ok(s.prompts.every(p => !p.cacheKey && p.capability === 'google'));
});

// ---------- the picker ----------
test('picker: the key is checked, the app id comes from the client id, and the session hands out a drive.file token', async () => {
  const s = await setup();
  assert.match((await s.auth.pickerSession()).error, /isn't set up/);
  assert.match((await s.auth.savePickerKey('nope')).error, /AIza/);
  assert.match((await s.auth.savePickerKey('AIza' + 'x'.repeat(35))).error, /project number/, 'the fake client id has no number at the start');
  await s.auth.saveClient({ installed: { client_id: '123456789012-abcdef.apps.googleusercontent.com', client_secret: s.g.clientSecret } });
  assert.deepEqual(await s.auth.savePickerKey('AIza' + 'x'.repeat(35)), { ok: true });
  assert.equal(s.auth.status().hasPickerKey, true);
  assert.match((await s.auth.pickerSession()).error, /isn't connected/, 'a new client id drops the old sign-in');
});

// ---------- the Clerk in the crew (phase 5) ----------
test('the Clerk: awake, with every Google tool plus fs.read and nothing that touches the shell or local files', async () => {
  const { makeRoster } = await import('../src/crew/roster.js');
  const { makeCrewTools } = await import('../src/crew/orchestrate.js');
  const r = makeRoster({ workspace: '/w' }), c = r.get('clerk');
  assert.equal(c.awake, true);
  assert.deepEqual(c.grants.filter(g => !/^(drive|docs|sheets|slides)\./.test(g)), ['fs.read']);
  assert.equal(c.grants.filter(g => g.startsWith('docs.')).length, 4);
  assert.equal(c.grants.filter(g => g.startsWith('sheets.')).length, 6);
  assert.equal(c.grants.filter(g => g.startsWith('slides.')).length, 5);
  assert.equal(c.grants.filter(g => g.startsWith('drive.')).length, 6);
  assert.match(c.systemPrompt, /capuchin/);
  for (const other of r.ids().filter(id => id !== 'clerk')) assert.ok(!(r.get(other).grants || []).some(g => /^(drive|docs|sheets|slides)\./.test(g)), `${other} has no Google tools`);
  const dispatch = makeCrewTools({ roster: r }).find(t => t.name === 'crew.dispatch');
  assert.ok(dispatch.inputSchema.properties.worker.enum.includes('clerk'), 'the Chief can hand the Clerk work');
  assert.match(dispatch.description, /clerk \(The Clerk: Clerk: works in Google Docs, Sheets and Slides\)/);
});

test('the Clerk in the village: a capuchin with its own glow, a home on plot c1-b, a door there, sounds and a council seat', async () => {
  const { SPECIES, LIGHT, CREW } = await import('../ui/station/ape/cast.js');
  const { DOORS, HOMES } = await import('../ui/station/ape/world.js');
  const { PLOTS } = await import('../ui/station/ape/canopy.js');
  const { SOUNDS } = await import('../ui/station/ape/chatter-lines.js');
  const { COUNCIL_SEATS } = await import('../ui/station/ape/culture.js');
  assert.ok(CREW.includes('clerk'));
  assert.equal(SPECIES.clerk.species, 'Capuchin');
  const others = Object.entries(LIGHT).filter(([k]) => k !== 'clerk').map(([, c]) => c);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  assert.ok(others.every(c => dist(c, LIGHT.clerk) > 60), 'the ink-green glow is distinct from every other colour');
  assert.deepEqual(HOMES.clerk, { story: 'Canopy 1', place: 'the counting house', plot: 'c1-b' });
  const plot = PLOTS.find(p => p.id === 'c1-b');
  assert.deepEqual(DOORS.clerk, { lane: 'c1', x: plot.x });
  assert.ok(SOUNDS.clerk.length >= 4);
  assert.equal(typeof COUNCIL_SEATS.clerk, 'number');
  const taken = new Set(Object.values(HOMES).map(h => h.plot).filter(Boolean));
  assert.equal(PLOTS.filter(p => p.story === 1 && !taken.has(p.id)).length, 3, 'three free plots left on Canopy 1');
});
