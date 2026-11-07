// The Clerk, phase 3: Google Sheets (create, read, write with formulas, append,
// tabs, charts), with overwrite warnings and backups, against the simulated Google.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { memFs } from './helpers/memfs.js';
import { fakeGoogle } from './helpers/fake-google.js';
import { makeGoogleAuth } from '../src/google/auth.js';
import { makeGoogleApi } from '../src/google/api.js';
import { makeDrive, MIME } from '../src/google/drive.js';
import { makeSheets, parseCell, parseRange, colName, colIndex, a1, checkRows } from '../src/google/sheets.js';
import { makeSheetsTools } from '../src/tools/google-sheets.js';
import { makeDriveTools } from '../src/tools/google-drive.js';
import { makeRegistry } from '../src/tools/registry.js';
import { makeUndoStore } from '../src/store/undo.js';

async function setup() {
  const g = fakeGoogle(), fs = memFs(), clock = { now: () => Date.UTC(2026, 10, 6, 15, 0) };
  const auth = makeGoogleAuth({ fsp: fs, dir: '/data/google', fetchImpl: g.fetchImpl, clock, randomBytes, redirectUri: 'http://127.0.0.1:8787/api/google/callback' });
  const api = makeGoogleApi({ auth, fetchImpl: g.fetchImpl, sleep: async () => {} });
  const drive = makeDrive({ api }), sheets = makeSheets({ api });
  let n = 0;
  const undo = makeUndoStore({ fsp: fs, dir: '/data/undo', newId: p => `${p}_${++n}`, clock });
  const tools = [...makeDriveTools({ auth, drive, undo }), ...makeSheetsTools({ auth, drive, sheets, undo, clock })];
  const reg = makeRegistry(tools);
  const prompts = [];
  const ctx = { emit: () => {}, newId: p => `${p}_${++n}`, grants: new Set(tools.map(t => t.name)), interactive: true, runId: 'run_s1', consent: { request: async p => { prompts.push(p); return true; } } };
  await auth.saveClient(g.keyJson());
  await auth.finishConnect(g.consent(auth.startConnect().url));
  const call = (tool, args, c = ctx) => reg.dispatch({ tool, args }, c);
  const newest = name => [...g.files.values()].filter(f => f.mimeType === MIME.sheet && f.name === name).pop();
  const revert = () => undo.revert('run_s1', { guard: async () => null, remote: r => drive.revertChange(r) });
  return { g, auth, call, ctx, prompts, newest, revert };
}

const BUDGET = [['Item', 'Cost'], ['Tent', 120], ['Stove', '45'], ['Food', 60.5], ['Total', '=SUM(B2:B4)']];

test('A1 helpers: column letters, cells, ranges, quoted tab names, row checks', () => {
  assert.deepEqual([0, 25, 26, 51, 701, 702].map(colName), ['A', 'Z', 'AA', 'AZ', 'ZZ', 'AAA']);
  assert.deepEqual(['A', 'Z', 'AA', 'AAA'].map(colIndex), [0, 25, 26, 702]);
  assert.deepEqual(parseCell('c7'), { col: 2, row: 6 });
  assert.equal(parseCell('A0'), null); assert.equal(parseCell('7C'), null); assert.equal(parseCell('A1; DROP'), null);
  assert.deepEqual(parseRange('D9:B2'), { col: 1, row: 1, endCol: 3, endRow: 8 });
  assert.equal(a1('Sheet1', { col: 0, row: 0, endCol: 1, endRow: 4 }), 'Sheet1!A1:B5');
  assert.equal(a1("Bob's costs", { col: 2, row: 1, endCol: 2, endRow: 1 }), "'Bob''s costs'!C2");
  assert.match(checkRows([]).error, /list of rows/);
  assert.match(checkRows([['a', { x: 1 }]]).error, /Row 1/);
  assert.match(checkRows([['a'], 'b']).error, /Row 2/);
  assert.deepEqual(checkRows([['a', null], [1]]), { rows: [['a', ''], [1]], width: 2 });
});

test('sheets.create: filled, formulas work, header bold and frozen; read shows letters and row numbers', async () => {
  const s = await setup();
  const r = await s.call('sheets.create', { title: 'Trip budget', rows: BUDGET, tab: 'Costs' });
  assert.equal(r.ok, true, r.content);
  assert.match(s.prompts[0].summary, /^make a Google Sheet "Trip budget" at the top of My Drive with 5 rows × 2 columns\n\n\| Item \| Cost \|\n\| Tent \| 120 \|/);
  const f = s.newest('Trip budget'), tab = f.sheet.tabs[0];
  assert.equal(tab.title, 'Costs');
  assert.ok(tab.bold.has(0)); assert.equal(tab.frozen, 1);
  const read = await s.call('sheets.read', { fileId: f.id });
  assert.match(read.content, /Tabs: "Costs"/);
  assert.match(read.content, /\|   \| A \| B \|/);
  assert.match(read.content, /\| 5 \| Total \| 225\.5 \|/);
  const formulas = await s.call('sheets.read', { fileId: f.id, formulas: true, range: 'A5:B5' });
  assert.match(formulas.content, /Costs!A5:B5 \(formulas\):[\s\S]*\| 5 \| Total \| =SUM\(B2:B4\) \|/);
});

test('sheets.write: the preview counts the filled cells it would overwrite; the range never spills', async () => {
  const s = await setup();
  await s.call('sheets.create', { title: 'B', rows: BUDGET });
  const f = s.newest('B');
  await s.call('sheets.write', { fileId: f.id, start: 'D1', rows: [['Note'], ['cheap']] });
  assert.match(s.prompts.at(-1).summary, /at Sheet1!D1:D2\n {2}\(all those cells are empty now\)/);
  await s.call('sheets.write', { fileId: f.id, start: 'B2', rows: [[100, 'x'], [50]] });
  assert.match(s.prompts.at(-1).summary, /at Sheet1!B2:C3\n {2}⚠ overwrites 2 filled cells/);
  const w = s.g.sheetRequests.length;
  assert.match((await s.call('sheets.write', { fileId: f.id, start: 'nope', rows: [[1]] })).content, /isn't a cell/);
  assert.match((await s.call('sheets.write', { fileId: f.id, tab: 'Nope', start: 'A1', rows: [[1]] })).content, /no tab called "Nope". Its tabs: "Sheet1"/);
  assert.match((await s.call('sheets.write', { fileId: f.id, start: 'A1', rows: 'a,b' })).content, /should be array/);
  assert.equal(s.g.sheetRequests.length, w);
  assert.match((await s.call('sheets.read', { fileId: f.id })).content, /\| 5 \| Total \| 210\.5 \|/);
});

test('sheets.append adds under the last row; sheets.tab adds a tab and refuses a duplicate', async () => {
  const s = await setup();
  await s.call('sheets.create', { title: 'A', rows: BUDGET.slice(0, 3) });
  const f = s.newest('A');
  const r = await s.call('sheets.append', { fileId: f.id, rows: [['Map', 9]] });
  assert.match(r.content, /at Sheet1!A4:B4/);
  await s.call('sheets.tab', { fileId: f.id, name: 'Notes' });
  assert.deepEqual(f.sheet.tabs.map(t => t.title), ['Sheet1', 'Notes']);
  assert.match((await s.call('sheets.tab', { fileId: f.id, name: 'notes' })).content, /already has a tab/);
  await s.call('sheets.write', { fileId: f.id, tab: 'Notes', start: 'A1', rows: [['hi']] });
  assert.match((await s.call('sheets.read', { fileId: f.id, tab: 'Notes' })).content, /\| 1 \| hi \|/);
});

test('sheets.chart: column, line and pie charts from a block; too-small ranges are refused', async () => {
  const s = await setup();
  await s.call('sheets.create', { title: 'C', rows: [['Month', 'Rain', 'Sun'], ['Jan', 80, 40], ['Feb', 60, 55], ['Mar', 40, 90]] });
  const f = s.newest('C');
  const r = await s.call('sheets.chart', { fileId: f.id, range: 'A1:C4', type: 'column', title: 'Weather' });
  assert.equal(r.ok, true, r.content);
  assert.match(s.prompts.at(-1).summary, /add a column chart "Weather" to Google Sheet "C"\n {2}from Sheet1!A1:C4 \(labels in column A, 2 series\), placed at column E/);
  const spec = f.sheet.tabs[0].charts[0].spec.basicChart;
  assert.equal(spec.chartType, 'COLUMN'); assert.equal(spec.series.length, 2); assert.equal(spec.headerCount, 1);
  await s.call('sheets.chart', { fileId: f.id, range: 'A1:B4', type: 'pie' });
  assert.ok(f.sheet.tabs[0].charts[1].spec.pieChart);
  assert.deepEqual(f.sheet.tabs[0].charts.map(c => c.anchor.rowIndex), [0, 20], 'the second chart goes below the first');
  assert.match(s.prompts.at(-1).summary, /below the 1 chart already there/);
  assert.match((await s.call('sheets.chart', { fileId: f.id, range: 'A1:A4', type: 'line' })).content, /at least two columns/);
  assert.match((await s.call('sheets.chart', { fileId: f.id, range: 'A1:B2', type: 'line' })).content, /two rows of data/);
  assert.match((await s.call('sheets.read', { fileId: f.id })).content, /"Sheet1" \(2 charts\)/);
});

test('editing a spreadsheet the job did not make: one backup first; a Sheet made in the job needs none', async () => {
  const s = await setup();
  const theirs = s.g.addFile({ name: 'Household', mimeType: MIME.sheet, visible: true });
  await s.call('sheets.append', { fileId: theirs.id, rows: [['Rent', 900]] });
  assert.match(s.prompts.at(-1).summary, /a backup copy is saved in Drive first/);
  await s.call('sheets.write', { fileId: theirs.id, start: 'C1', rows: [['ok']] });
  const backups = [...s.g.files.values()].filter(f => f.name.startsWith('Household (backup before MonkeyCraft, 2026-11-06 15:00)'));
  assert.equal(backups.length, 1);
  assert.equal(backups[0].sheet.tabs[0].cells.size, 0, 'the backup is from before');
  await s.call('sheets.create', { title: 'Mine', rows: [['a']] });
  await s.call('sheets.append', { fileId: s.newest('Mine').id, rows: [['b']] });
  assert.equal([...s.g.files.values()].filter(f => f.name.startsWith('Mine (backup')).length, 0);
  const out = await s.revert();
  assert.ok(out.some(o => o.path === 'Google Drive: new Sheet "Mine"' && o.result === 'binned'));
  assert.ok(out.some(o => o.path === 'Google Drive: edited "Household"' && /backup copy from before the job is in your Drive: "Household \(backup/.test(o.result)));
});

test('sheets tools refuse non-Sheets, binned Sheets and work only when connected; reads ask nothing', async () => {
  const s = await setup();
  const doc = s.g.addFile({ name: 'D', mimeType: MIME.doc, visible: true });
  assert.match((await s.call('sheets.read', { fileId: doc.id })).content, /isn't a Google Sheet/);
  await s.call('sheets.create', { title: 'X' });
  const x = s.newest('X');
  await s.call('sheets.read', { fileId: x.id });
  const asked = s.prompts.length;
  await s.call('drive.bin', { fileId: x.id });
  assert.match((await s.call('sheets.append', { fileId: x.id, rows: [['a']] })).content, /in the bin/);
  assert.equal(s.prompts.length, asked + 1, 'only the bin asked');
  await s.auth.disconnect();
  assert.match((await s.call('sheets.create', { title: 'Y' })).content, /Connect Google/);
  assert.ok(s.prompts.every(p => !p.cacheKey && p.capability === 'google'));
});
