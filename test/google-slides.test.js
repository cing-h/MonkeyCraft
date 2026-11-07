// The Clerk, phase 4: Google Slides (an outline becomes a deck with speaker
// notes; add slides, set notes, exact replace; backups), against the simulated Google.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { memFs } from './helpers/memfs.js';
import { fakeGoogle } from './helpers/fake-google.js';
import { makeGoogleAuth } from '../src/google/auth.js';
import { makeGoogleApi } from '../src/google/api.js';
import { makeDrive, MIME } from '../src/google/drive.js';
import { makeSlides, parseOutline } from '../src/google/slides.js';
import { makeSlidesTools } from '../src/tools/google-slides.js';
import { makeRegistry } from '../src/tools/registry.js';
import { makeUndoStore } from '../src/store/undo.js';

async function setup() {
  const g = fakeGoogle(), fs = memFs(), clock = { now: () => Date.UTC(2026, 10, 6, 16, 0) };
  const auth = makeGoogleAuth({ fsp: fs, dir: '/data/google', fetchImpl: g.fetchImpl, clock, randomBytes, redirectUri: 'http://127.0.0.1:8787/api/google/callback' });
  const api = makeGoogleApi({ auth, fetchImpl: g.fetchImpl, sleep: async () => {} });
  let n = 0, o = 0;
  const drive = makeDrive({ api }), slides = makeSlides({ api, newObjectId: () => `obj_${String(++o).padStart(4, '0')}` });
  const undo = makeUndoStore({ fsp: fs, dir: '/data/undo', newId: p => `${p}_${++n}`, clock });
  const tools = makeSlidesTools({ auth, drive, slides, undo, clock });
  const reg = makeRegistry(tools);
  const prompts = [];
  const ctx = { emit: () => {}, newId: p => `${p}_${++n}`, grants: new Set(tools.map(t => t.name)), interactive: true, runId: 'run_p1', consent: { request: async p => { prompts.push(p); return true; } } };
  await auth.saveClient(g.keyJson());
  await auth.finishConnect(g.consent(auth.startConnect().url));
  const call = (tool, args) => reg.dispatch({ tool, args }, ctx);
  const newest = name => [...g.files.values()].filter(f => f.mimeType === MIME.slides && f.name === name).pop();
  const revert = () => undo.revert('run_p1', { guard: async () => null, remote: r => drive.revertChange(r) });
  return { g, auth, call, prompts, newest, revert };
}
const txt = sh => sh.chars.map(c => c.ch).join('');

const OUTLINE = `# River trip
A weekend plan
Notes: Welcome everyone.

## Packing
- Tent
  - poles and pegs
- **Stove** and fuel
Pack light.
> Remind them about the weight limit.
> And the bear can.

## Questions`;

test('outline: title, subtitle, slides, nested bullets, notes, inline styles; bad outlines are refused', () => {
  const o = parseOutline(OUTLINE);
  assert.equal(o.title.text, 'River trip');
  assert.deepEqual(o.subtitle.map(l => l.text), ['A weekend plan']);
  assert.equal(o.titleNotes, 'Welcome everyone.');
  assert.deepEqual(o.slides.map(s => s.text), ['Packing', 'Questions']);
  assert.deepEqual(o.slides[0].lines.map(l => [l.text, l.bullet, l.level]), [['Tent', true, 0], ['poles and pegs', true, 1], ['Stove and fuel', true, 0], ['Pack light.', false, 0]]);
  assert.equal(o.slides[0].lines[2].spans[0].bold, true);
  assert.equal(o.slides[0].notes, 'Remind them about the weight limit.\nAnd the bear can.');
  assert.equal(o.slides[1].lines.length, 0);
  assert.match(parseOutline('').error, /empty/);
  assert.match(parseOutline('## A\n# Late title').error, /first line/);
  assert.match(parseOutline(Array.from({ length: 101 }, (_, i) => `## S${i}`).join('\n')).error, /at most 100/);
  assert.deepEqual(parseOutline('# One\n# Two', { requireTitle: false }).slides.map(s => s.text), ['One', 'Two']);
});

test('slides.create: a title slide plus one slide per ##, with bullets, levels, styles and speaker notes', async () => {
  const s = await setup();
  const r = await s.call('slides.create', { outline: OUTLINE });
  assert.equal(r.ok, true, r.content);
  assert.match(r.content, /with 3 slides/);
  assert.equal(s.prompts[0].summary, 'make a Google Slides deck "River trip" at the top of My Drive: a title slide and 2 slides\n  1. Packing  (with notes)\n  2. Questions');
  const d = s.newest('River trip').deck;
  assert.deepEqual(d.slides.map(x => x.layout), ['TITLE', 'TITLE_AND_BODY', 'TITLE_ONLY']);
  assert.equal(txt(d.slides[0].shapes[0]), 'River trip');
  assert.equal(txt(d.slides[0].shapes[1]), 'A weekend plan');
  assert.equal(txt(d.slides[0].notes), 'Welcome everyone.');
  const body = d.slides[1].shapes[1];
  assert.equal(txt(body), 'Tent\npoles and pegs\nStove and fuel\nPack light.', 'the indent tabs are gone');
  assert.deepEqual(body.bullets, { 0: 0, 1: 1, 2: 0 }, 'three bullets, one indented; the plain line has none');
  assert.equal(body.chars[txt(body).indexOf('Stove')].ts.bold, true, 'bold lands on the right word after the tabs are removed');
  assert.equal(body.chars[txt(body).indexOf('and fuel')].ts.bold, undefined);
  assert.equal(txt(d.slides[1].notes), 'Remind them about the weight limit.\nAnd the bear can.');
});

test('slides.create: without a subtitle the empty subtitle box is removed; a title is required', async () => {
  const s = await setup();
  await s.call('slides.create', { outline: '# Just a title\n\n## One\n- a' });
  assert.deepEqual(s.newest('Just a title').deck.slides[0].shapes.map(x => x.type), ['CENTERED_TITLE']);
  assert.match((await s.call('slides.create', { outline: '## No title\n- a' })).content, /needs a deck title/);
});

test('slides.read gives back the same outline, with slide numbers', async () => {
  const s = await setup();
  await s.call('slides.create', { outline: OUTLINE });
  const r = await s.call('slides.read', { fileId: s.newest('River trip').id });
  assert.match(r.content, /\(3 slides\)/);
  for (const want of ['# River trip   [slide 1]', 'A weekend plan', 'Notes: Welcome everyone.', '## Packing   [slide 2]', '- Tent', '  - poles and pegs', '- Stove and fuel', 'Pack light.', 'Notes: Remind them about the weight limit.\n> And the bear can.', '## Questions   [slide 3]'])
    assert.ok(r.content.includes(want), `missing ${JSON.stringify(want)}\n${r.content}`);
});

test('slides.add, slides.notes and slides.replace; checks before anything is sent', async () => {
  const s = await setup();
  await s.call('slides.create', { outline: OUTLINE });
  const f = s.newest('River trip');
  assert.equal((await s.call('slides.add', { fileId: f.id, outline: '## Thanks\nSee you there.\nNotes: smile' })).ok, true);
  assert.equal(f.deck.slides.length, 4);
  assert.equal(txt(f.deck.slides[3].notes), 'smile');
  await s.call('slides.notes', { fileId: f.id, slide: 2, notes: 'New notes.' });
  assert.equal(txt(f.deck.slides[1].notes), 'New notes.');
  await s.call('slides.notes', { fileId: f.id, slide: 2, notes: '' });
  assert.equal(txt(f.deck.slides[1].notes), '');
  await s.call('slides.notes', { fileId: f.id, slide: 3, notes: 'first notes on a slide without any' });
  assert.equal(txt(f.deck.slides[2].notes), 'first notes on a slide without any');
  const sent = s.g.slideRequests.length;
  assert.match((await s.call('slides.notes', { fileId: f.id, slide: 9, notes: 'x' })).content, /has 4 slides, so there is no slide 9/);
  assert.match((await s.call('slides.add', { fileId: f.id, outline: 'just text' })).content, /no slides in that outline/);
  assert.match((await s.call('slides.replace', { fileId: f.id, find: 'Moon', replaceWith: 'x' })).content, /isn't on the slides/);
  assert.match((await s.call('slides.replace', { fileId: f.id, find: 'e', replaceWith: 'x' })).content, /times, not 1/);
  assert.equal(s.g.slideRequests.length, sent, 'nothing was sent');
  const r = await s.call('slides.replace', { fileId: f.id, find: 'Tent', replaceWith: 'Hammock' });
  assert.equal(r.ok, true); assert.match(txt(f.deck.slides[1].shapes[1]), /^Hammock\n/);
});

test('editing a deck the job did not make: one backup first; Revert bins what the job made and points to backups', async () => {
  const s = await setup();
  const theirs = s.g.addFile({ name: 'Club talk', mimeType: MIME.slides, visible: true });
  await s.call('slides.add', { fileId: theirs.id, outline: '## Extra' });
  assert.match(s.prompts.at(-1).summary, /a backup copy is saved in Drive first/);
  await s.call('slides.notes', { fileId: theirs.id, slide: 1, notes: 'hi' });
  const backups = [...s.g.files.values()].filter(f => f.name.startsWith('Club talk (backup before MonkeyCraft, 2026-11-06 16:00)'));
  assert.equal(backups.length, 1);
  assert.equal(backups[0].deck.slides.length, 1, 'the backup is from before');
  await s.call('slides.create', { outline: '# Mine' });
  const out = await s.revert();
  assert.ok(out.some(o => o.path === 'Google Drive: new deck "Mine"' && o.result === 'binned'));
  assert.ok(out.some(o => o.path === 'Google Drive: edited "Club talk"' && /"Club talk \(backup/.test(o.result)));
});

test('slides tools refuse non-decks and binned decks, ask every time, and need Google connected', async () => {
  const s = await setup();
  const doc = s.g.addFile({ name: 'D', mimeType: MIME.doc, visible: true });
  assert.match((await s.call('slides.read', { fileId: doc.id })).content, /isn't a Google Slides deck/);
  const deck = s.g.addFile({ name: 'Old', mimeType: MIME.slides, visible: true });
  s.g.files.get(deck.id).trashed = true;
  assert.match((await s.call('slides.add', { fileId: deck.id, outline: '## a' })).content, /in the bin/);
  await s.call('slides.create', { outline: '# A' }); await s.call('slides.create', { outline: '# B' });
  assert.equal(s.prompts.length, 2);
  assert.ok(s.prompts.every(p => !p.cacheKey && p.capability === 'google'));
  await s.auth.disconnect();
  assert.match((await s.call('slides.create', { outline: '# C' })).content, /Connect Google/);
});
