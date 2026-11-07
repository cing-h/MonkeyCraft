// The Clerk, phase 1: Google sign-in (PKCE, refresh, revoke, owner-only
// storage), the Drive tools through the normal pipeline (consent every time,
// no sharing, no delete), and "Revert this job" for Google changes. All of it
// runs against a simulated Google (test/helpers/fake-google.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { memFs } from './helpers/memfs.js';
import { fakeGoogle } from './helpers/fake-google.js';
import { makeGoogleAuth, parseClientJson, SCOPE } from '../src/google/auth.js';
import { makeGoogleApi } from '../src/google/api.js';
import { makeDrive, MIME } from '../src/google/drive.js';
import { makeDriveTools } from '../src/tools/google-drive.js';
import { makeRegistry } from '../src/tools/registry.js';
import { makeUndoStore } from '../src/store/undo.js';
import { googleRoutes } from '../src/routes/google.js';
import { validateEvent } from '../src/events.js';

const REDIRECT = 'http://127.0.0.1:8787/api/google/callback';
function setup({ now = 1_000_000 } = {}) {
  const g = fakeGoogle(), fs = memFs(), clock = { now: () => now };
  const auth = makeGoogleAuth({ fsp: fs, dir: '/data/google', fetchImpl: g.fetchImpl, clock, randomBytes, redirectUri: REDIRECT });
  const drive = makeDrive({ api: makeGoogleApi({ auth, fetchImpl: g.fetchImpl, sleep: async () => {} }) });
  let n = 0;
  const undo = makeUndoStore({ fsp: fs, dir: '/data/undo', newId: p => `${p}_${++n}`, clock });
  const tools = makeDriveTools({ auth, drive, undo });
  const reg = makeRegistry(tools);
  const events = [], prompts = [];
  let answer = true;
  const ctx = {
    emit: (type, p) => events.push({ type, ...p }), newId: p => `${p}_${++n}`, grants: new Set(tools.map(t => t.name)), interactive: true, runId: 'run_g1',
    consent: { request: async p => { prompts.push(p); return answer; } }
  };
  const call = (tool, args) => reg.dispatch({ tool, args }, ctx);
  return { g, fs, auth, drive, undo, reg, ctx, events, prompts, call, setAnswer: v => { answer = v; }, clock, advance: ms => { now += ms; } };
}
async function connect(s) {
  assert.deepEqual(await s.auth.saveClient(s.g.keyJson()), { ok: true });
  const { url } = s.auth.startConnect();
  return s.auth.finishConnect(s.g.consent(url));
}

// ---------- the sign-in key ----------
test('the sign-in key: accepts the downloaded desktop JSON, refuses web keys and junk', () => {
  const g = fakeGoogle();
  assert.equal(parseClientJson(g.keyJson()).value.client_id, g.clientId);
  assert.ok(parseClientJson({ client_id: g.clientId, client_secret: g.clientSecret }).value);
  assert.match(parseClientJson('{nope').error, /valid JSON/);
  assert.match(parseClientJson({ web: { client_id: g.clientId, client_secret: 'x'.repeat(10) } }).error, /Desktop app/);
  assert.match(parseClientJson({ installed: { client_id: 'evil.example.com', client_secret: 'x'.repeat(10) } }).error, /client ID/);
});

// ---------- connecting ----------
test('connect: the consent page asks only for drive.file, offline, with PKCE and a state', async () => {
  const s = setup();
  assert.match(s.auth.startConnect().error, /key first/);
  await s.auth.saveClient(s.g.keyJson());
  const u = new URL(s.auth.startConnect().url), p = u.searchParams;
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(p.get('scope'), SCOPE);
  assert.equal(p.get('redirect_uri'), REDIRECT);
  assert.equal(p.get('access_type'), 'offline');
  assert.equal(p.get('code_challenge_method'), 'S256');
  assert.ok(p.get('state').length >= 30 && p.get('code_challenge').length >= 40);
  assert.ok(!u.toString().includes(s.g.clientSecret), 'the secret never goes in the browser');
});

test('connect: a good sign-in is stored owner-only in data/google, and survives a restart', async () => {
  const s = setup();
  assert.deepEqual(await connect(s), { ok: true });
  assert.equal(s.auth.status().connected, true);
  const saved = JSON.parse(s.fs.files.get('/data/google/token.json').toString());
  assert.match(saved.refresh_token, /^rt-/);
  const again = makeGoogleAuth({ fsp: s.fs, dir: '/data/google', fetchImpl: s.g.fetchImpl, clock: s.clock, randomBytes, redirectUri: REDIRECT });
  assert.deepEqual(await again.load(), { ok: true });
  assert.equal(again.status().connected, true);
  assert.equal(JSON.stringify(again.status()).includes('rt-'), false, 'status never shows the sign-in itself');
});

test('connect: wrong or reused state, a "no" on the Google page, and missing permission are all refused', async () => {
  const s = setup();
  await s.auth.saveClient(s.g.keyJson());
  const { url } = s.auth.startConnect();
  const back = s.g.consent(url);
  assert.match((await s.auth.finishConnect({ ...back, state: 'forged' })).error, /old or unknown/);
  assert.deepEqual(await s.auth.finishConnect(back), { ok: true });
  assert.match((await s.auth.finishConnect(back)).error, /old or unknown/, 'a state works once');
  const s2 = setup(); await s2.auth.saveClient(s2.g.keyJson());
  const st = new URL(s2.auth.startConnect().url).searchParams.get('state');
  assert.match((await s2.auth.finishConnect({ state: st, error: 'access_denied' })).error, /said no/);
  const s3 = setup(); await s3.auth.saveClient(s3.g.keyJson());
  const narrow = s3.g.consent(s3.auth.startConnect().url, { scope: 'openid' });
  assert.match((await s3.auth.finishConnect(narrow)).error, /didn't grant/);
  assert.equal(s3.auth.status().connected, false);
});

test('connect: an old sign-in link expires after 10 minutes', async () => {
  const s = setup();
  await s.auth.saveClient(s.g.keyJson());
  const back = s.g.consent(s.auth.startConnect().url);
  s.advance(11 * 60_000);
  assert.match((await s.auth.finishConnect(back)).error, /old or unknown/);
});

test('sign-in: refreshes before it expires, retries once after a 401, and reports a revoked sign-in plainly', async () => {
  const s = setup();
  await connect(s);
  await s.call('drive.find', {});
  const tokenCalls = () => s.g.calls.filter(c => c.url.includes('/token')).length;
  const before = tokenCalls();
  s.advance(3600_000);                                   // the access token is now stale
  assert.equal((await s.call('drive.find', {})).ok, true);
  assert.equal(tokenCalls(), before + 1, 'refreshed once');
  s.g.expireAccess();                                    // Google forgot it early: the 401 path
  assert.equal((await s.call('drive.find', {})).ok, true);
  s.g.revokeAll(); s.advance(3600_000);
  const r = await s.call('drive.find', {});
  assert.equal(r.ok, false);
  assert.match(r.content, /isn't connected any more/);
  assert.equal(s.auth.status().connected, false);
  assert.match(s.auth.status().lastError, /Connect Google again/);
});

test('disconnect: forgets the sign-in and tells Google to revoke it', async () => {
  const s = setup();
  await connect(s);
  await s.auth.disconnect();
  assert.equal(s.auth.status().connected, false);
  assert.equal(s.fs.files.has('/data/google/token.json'), false);
  assert.ok(s.g.calls.some(c => c.url.startsWith('https://oauth2.googleapis.com/revoke')));
});

test('a new sign-in key drops the old sign-in (it belonged to the old key)', async () => {
  const s = setup();
  await connect(s);
  await s.auth.saveClient({ installed: { client_id: 'other-99999.apps.googleusercontent.com', client_secret: 'GOCSPX-other' } });
  assert.equal(s.auth.status().connected, false);
});

// ---------- the Drive tools ----------
test('drive tools: not connected → a plain message, nothing asked, nothing sent', async () => {
  const s = setup();
  for (const [t, a] of [['drive.find', {}], ['drive.folder', { name: 'X' }], ['drive.bin', { fileId: 'file000000000001' }]]) {
    const r = await s.call(t, a);
    assert.equal(r.ok, false); assert.match(r.content, /Connect Google/);
  }
  assert.equal(s.prompts.length, 0);
  assert.equal(s.g.calls.length, 0);
});

test('drive tools: find and read see only MonkeyCraft\'s files (drive.file)', async () => {
  const s = setup(); await connect(s);
  const mine = s.g.addFile({ name: 'Trip plan', mimeType: MIME.doc, visible: true, text: 'Day 1: the river.' });
  const secret = s.g.addFile({ name: 'Tax return', mimeType: MIME.doc, visible: false, text: 'private' });
  const f = await s.call('drive.find', { name: 'a' });
  assert.match(f.content, /Trip plan/); assert.doesNotMatch(f.content, /Tax return/);
  const r = await s.call('drive.read', { fileId: mine.id });
  assert.match(r.content, /Day 1: the river\./);
  const hidden = await s.call('drive.read', { fileId: secret.id });
  assert.equal(hidden.ok, false); assert.match(hidden.content, /couldn't find/);
  assert.equal(s.prompts.length, 0, 'reading asks nothing');
  const q = await s.call('drive.find', { name: "it's \\ odd" });
  assert.equal(q.ok, true, 'quotes and backslashes in a name are escaped');
});

test('drive tools: every change asks first with a preview, every time; "no" sends nothing', async () => {
  const s = setup(); await connect(s);
  const doc = s.g.addFile({ name: 'Draft', mimeType: MIME.doc, visible: true });
  s.setAnswer(false);
  const sent = s.g.calls.length;
  const r = await s.call('drive.rename', { fileId: doc.id, name: 'Final' });
  assert.equal(r.ok, false); assert.match(r.content, /said no/);
  assert.equal(s.g.files.get(doc.id).name, 'Draft');
  assert.equal(s.g.calls.filter((c, i) => i >= sent && c.method === 'PATCH').length, 0);
  s.setAnswer(true);
  await s.call('drive.rename', { fileId: doc.id, name: 'Final' });
  await s.call('drive.rename', { fileId: doc.id, name: 'Final 2' });
  assert.equal(s.prompts.length, 3, 'asked every time');
  assert.equal(s.prompts[1].summary, 'rename Google Doc "Draft"\n  → "Final"');
  assert.equal(s.prompts.every(p => !p.cacheKey), true, 'Google changes are never remembered as "always allow"');
  assert.equal(s.prompts[0].capability, 'google');
});

test('drive tools: make a folder, move into it, bin; bad ids and the whole Drive are refused', async () => {
  const s = setup(); await connect(s);
  const doc = s.g.addFile({ name: 'Notes', mimeType: MIME.doc, visible: true });
  const mk = await s.call('drive.folder', { name: 'Clerk work' });
  assert.equal(mk.ok, true);
  const folder = [...s.g.files.values()].find(f => f.name === 'Clerk work');
  assert.equal(folder.mimeType, MIME.folder);
  const mv = await s.call('drive.move', { fileId: doc.id, folderId: folder.id });
  assert.equal(mv.ok, true); assert.deepEqual(s.g.files.get(doc.id).parents, [folder.id]);
  assert.match((await s.call('drive.move', { fileId: doc.id, folderId: folder.id })).content, /already in/);
  assert.match((await s.call('drive.move', { fileId: folder.id, folderId: doc.id })).content, /isn't a folder/);
  const b = await s.call('drive.bin', { fileId: doc.id });
  assert.equal(b.ok, true); assert.equal(s.g.files.get(doc.id).trashed, true);
  assert.match((await s.call('drive.bin', { fileId: 'root' })).content, /safety rule/);
  assert.match((await s.call('drive.read', { fileId: '../../etc' })).content, /isn't a Google file id/);
  assert.match((await s.call('drive.folder', { name: '   ' })).content, /needs a name/);
});

test('drive tools: no sharing and no outright delete exist, and no request ever touches permissions or DELETE', async () => {
  const s = setup(); await connect(s);
  const names = makeDriveTools({ auth: s.auth, drive: s.drive, undo: s.undo }).map(t => t.name);
  assert.deepEqual(names.sort(), ['drive.bin', 'drive.find', 'drive.folder', 'drive.move', 'drive.read', 'drive.rename']);
  const doc = s.g.addFile({ name: 'A', mimeType: MIME.doc, visible: true });
  await s.call('drive.folder', { name: 'F' }); await s.call('drive.rename', { fileId: doc.id, name: 'B' }); await s.call('drive.bin', { fileId: doc.id });
  assert.equal(s.g.calls.some(c => c.method === 'DELETE' || /permissions/.test(c.url)), false);
});

test('drive tools: Google errors become plain sentences, and events stay valid', async () => {
  const s = setup(); await connect(s);
  const doc = s.g.addFile({ name: 'A', mimeType: MIME.doc, visible: true });
  s.g.failNext(403, { error: { message: 'insufficient permissions' } });
  const r = await s.call('drive.read', { fileId: doc.id });
  assert.equal(r.ok, false); assert.match(r.content, /isn't allowed/);
  await s.call('drive.rename', { fileId: doc.id, name: 'B' });
  for (const e of s.events) {
    const { type, ...payload } = e;
    const v = validateEvent({ v: 1, seq: 1, ts: 1, runId: 'run_g1', agentId: 'clerk', type, ...payload });
    assert.ok(v.ok, `${type}: ${JSON.stringify(v.errors)}`);
  }
});

// ---------- "Revert this job" ----------
test('revert: bins what the job made, names back, moves back and unbins — newest first', async () => {
  const s = setup(); await connect(s);
  const doc = s.g.addFile({ name: 'Report', mimeType: MIME.doc, visible: true });
  const old = s.g.addFile({ name: 'Old', mimeType: MIME.doc, visible: true });
  await s.call('drive.folder', { name: 'Box' });
  const box = [...s.g.files.values()].find(f => f.name === 'Box');
  await s.call('drive.move', { fileId: doc.id, folderId: box.id });
  await s.call('drive.rename', { fileId: doc.id, name: 'Report v2' });
  await s.call('drive.bin', { fileId: old.id });
  const out = await s.undo.revert('run_g1', { guard: async () => null, remote: r => s.drive.revertChange(r) });
  assert.deepEqual(out.map(o => o.result), ['restored', 'restored', 'moved back', 'binned']);
  assert.equal(s.g.files.get(old.id).trashed, false);
  assert.equal(s.g.files.get(doc.id).name, 'Report');
  assert.deepEqual(s.g.files.get(doc.id).parents, [s.g.rootId]);
  assert.equal(box.trashed, true);
  const twice = await s.undo.revert('run_g1', { guard: async () => null, remote: r => s.drive.revertChange(r) });
  assert.ok(twice.every(o => o.result === 'skipped: already reverted'));
});

test('revert: never overwrites later changes, and says so when Google is unavailable', async () => {
  const s = setup(); await connect(s);
  const doc = s.g.addFile({ name: 'A', mimeType: MIME.doc, visible: true });
  await s.call('drive.rename', { fileId: doc.id, name: 'B' });
  s.g.files.get(doc.id).name = 'C (the user renamed it later)';
  const out = await s.undo.revert('run_g1', { guard: async () => null, remote: r => s.drive.revertChange(r) });
  assert.equal(out[0].result, 'skipped: it was renamed again afterwards');
  const s2 = setup(); await connect(s2);
  await s2.call('drive.folder', { name: 'X' });
  const out2 = await s2.undo.revert('run_g1', { guard: async () => null });
  assert.equal(out2[0].result, "skipped: Google isn't available");
});

test('revert: a change that failed half-way is skipped, not guessed at', async () => {
  const s = setup(); await connect(s);
  s.g.failNext(500);
  const r = await s.call('drive.folder', { name: 'Never made' });
  assert.equal(r.ok, false);
  const out = await s.undo.revert('run_g1', { guard: async () => null, remote: x => s.drive.revertChange(x) });
  assert.equal(out[0].result, 'skipped: the change never finished');
});

// ---------- the Settings routes ----------
test('routes: save key → connect → callback page → status → disconnect; errors are plain', async () => {
  const s = setup();
  const routes = googleRoutes({ auth: s.auth });
  const hit = async (method, path, { body, query = '' } = {}) => {
    const r = routes.find(x => x.method === method && x.path === path);
    let status, out, headers;
    const res = { writeHead: (st, h) => { status = st; headers = h; }, end: b => { out = b; } };
    await r.handle({ res, body, url: new URL(`http://127.0.0.1:8787${path}${query}`) });
    return { status, headers, body: headers['content-type'].includes('json') ? JSON.parse(out) : out };
  };
  assert.equal((await hit('POST', '/api/google/key', { body: { key: 'junk' } })).status, 400);
  assert.equal((await hit('POST', '/api/google/connect')).status, 400);
  assert.equal((await hit('POST', '/api/google/key', { body: { key: s.g.keyJson() } })).body.hasKey, true);
  const { url } = (await hit('POST', '/api/google/connect')).body;
  const back = s.g.consent(url);
  const bad = await hit('GET', '/api/google/callback', { query: `?code=${back.code}&state=<script>` });
  assert.equal(bad.status, 400); assert.doesNotMatch(bad.body, /<script>/);
  const good = await hit('GET', '/api/google/callback', { query: `?code=${back.code}&state=${back.state}` });
  assert.equal(good.status, 200); assert.match(good.body, /Google is connected/);
  assert.match(good.headers['content-security-policy'], /default-src 'none'/);
  assert.equal((await hit('GET', '/api/google')).body.connected, true);
  assert.equal((await hit('POST', '/api/google/disconnect')).body.connected, false);
});
