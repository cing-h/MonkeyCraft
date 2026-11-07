// A simulated Google for tests: the OAuth token endpoint (with PKCE checks,
// refresh, revoke) and enough of Drive v3 for the Clerk. It is a fetch()
// stand-in, so nothing touches the real Google account.
//
// Like real `drive.file` access, only files the app made (or that are marked
// `opened`) are visible; everything else is a 404.
import { createHash } from 'node:crypto';

const json = (status, obj) => ({ ok: status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj) });
const textRes = (status, t) => ({ ok: status < 300, status, json: async () => JSON.parse(t), text: async () => t });
const FOLDER = 'application/vnd.google-apps.folder';

export function fakeGoogle({ clientId = 'abc123-test.apps.googleusercontent.com', clientSecret = 'GOCSPX-testsecret' } = {}) {
  const codes = new Map();      // code -> { challenge, redirectUri, scope }
  const refresh = new Set(), access = new Set();
  const files = new Map();      // id -> file
  const calls = [];
  let n = 0;
  const id = () => `file${String(++n).padStart(12, '0')}`;
  files.set('rootfolder000001', { id: 'rootfolder000001', name: 'My Drive', mimeType: FOLDER, parents: [], trashed: false, visible: true, isRoot: true });
  const rootId = 'rootfolder000001';
  const pub = f => ({ id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: '2026-11-06T10:00:00.000Z', webViewLink: `https://drive.google.com/open?id=${f.id}`, parents: [...f.parents], trashed: f.trashed });
  const resolve = x => x === 'root' ? rootId : x;
  const ok = token => access.has(token);
  const see = fid => { const f = files.get(resolve(fid)); return f && (f.visible || f.isRoot) ? f : null; };
  let failNext = null;

  const fake = {
    docRequests: [],
    files, calls, clientId, clientSecret, rootId,
    keyJson: () => JSON.stringify({ installed: { client_id: clientId, client_secret: clientSecret, redirect_uris: ['http://localhost'] } }),
    /** The user says yes on Google's consent page: returns the redirect query Google would send. */
    consent(authUrl, { scope } = {}) {
      const u = new URL(authUrl), p = u.searchParams;
      if (p.get('client_id') !== clientId) throw new Error('wrong client');
      const code = `code-${++n}`;
      codes.set(code, { challenge: p.get('code_challenge'), redirectUri: p.get('redirect_uri'), scope: scope || p.get('scope') });
      return { code, state: p.get('state') };
    },
    expireAccess() { access.clear(); },
    revokeAll() { refresh.clear(); access.clear(); },
    /** A file the user already had, not made by MonkeyCraft (hidden unless opened). */
    addFile({ name, mimeType, visible = false, text = '' }) {
      const f = { id: id(), name, mimeType, parents: [rootId], trashed: false, visible, text };
      if (mimeType === DOC) { f.doc = newDoc(); if (text) f.doc.tokens.unshift(...[...text].map(ch => ch === '\n' ? { ch, ts: {}, ps: { namedStyleType: 'NORMAL_TEXT' } } : { ch, ts: {} })); }
      files.set(f.id, f); return f;
    },
    /** The user picks a hidden file in Google's picker: now MonkeyCraft may see it. */
    pick(fileId) { files.get(fileId).visible = true; },
    failNext(status, body = { error: { message: 'boom' } }) { failNext = { status, body }; },
    async fetch(input, opts = {}) {
      const u = new URL(String(input)), method = opts.method || 'GET';
      calls.push({ method, url: u.toString(), body: opts.body });
      if (u.host === 'oauth2.googleapis.com' && u.pathname === '/token') {
        const b = new URLSearchParams(opts.body);
        if (b.get('client_id') !== clientId || b.get('client_secret') !== clientSecret) return json(401, { error: 'invalid_client' });
        if (b.get('grant_type') === 'authorization_code') {
          const c = codes.get(b.get('code')); codes.delete(b.get('code'));
          if (!c) return json(400, { error: 'invalid_grant', error_description: 'bad code' });
          if (c.redirectUri !== b.get('redirect_uri')) return json(400, { error: 'redirect_uri_mismatch' });
          if (createHash('sha256').update(b.get('code_verifier') || '').digest('base64url') !== c.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE failed' });
          const rt = `rt-${++n}`, at = `at-${++n}`; refresh.add(rt); access.add(at);
          return json(200, { access_token: at, refresh_token: rt, expires_in: 3599, scope: c.scope, token_type: 'Bearer' });
        }
        if (b.get('grant_type') === 'refresh_token') {
          if (!refresh.has(b.get('refresh_token'))) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
          const at = `at-${++n}`; access.add(at);
          return json(200, { access_token: at, expires_in: 3599, scope: 'https://www.googleapis.com/auth/drive.file' });
        }
        return json(400, { error: 'unsupported_grant_type' });
      }
      if (u.host === 'oauth2.googleapis.com' && u.pathname === '/revoke') { refresh.delete(u.searchParams.get('token')); return json(200, {}); }
      const isDocs = u.host === 'docs.googleapis.com' && u.pathname.startsWith('/v1/documents');
      if (!isDocs && (u.host !== 'www.googleapis.com' || !u.pathname.startsWith('/drive/v3/files'))) return json(404, { error: { message: 'no such API in the fake' } });

      const tok = String(opts.headers?.authorization || '').replace(/^Bearer /, '');
      if (!ok(tok)) return json(401, { error: { message: 'Invalid Credentials' } });
      if (failNext) { const f = failNext; failNext = null; return json(f.status, f.body); }
      const body = opts.body ? JSON.parse(opts.body) : {};
      if (isDocs) return docsApi(u, method, body);
      const rest = u.pathname.slice('/drive/v3/files'.length).split('/').filter(Boolean).map(decodeURIComponent);

      if (!rest.length && method === 'GET') {
        const q = u.searchParams.get('q') || '';
        let list = [...files.values()].filter(f => f.visible && !f.isRoot);
        if (/trashed = false/.test(q)) list = list.filter(f => !f.trashed);
        const nm = q.match(/name contains '((?:\\.|[^'])*)'/); if (nm) { const s = nm[1].replace(/\\(.)/g, '$1'); list = list.filter(f => f.name.includes(s)); }
        const mt = q.match(/mimeType = '([^']*)'/); if (mt) list = list.filter(f => f.mimeType === mt[1]);
        const par = q.match(/'([^']*)' in parents/); if (par) list = list.filter(f => f.parents.includes(resolve(par[1])));
        return json(200, { files: list.slice(0, Number(u.searchParams.get('pageSize') || 100)).map(pub) });
      }
      if (!rest.length && method === 'POST') {
        const f = { id: id(), name: body.name, mimeType: body.mimeType, parents: (body.parents || [rootId]).map(resolve), trashed: false, visible: true, text: '' };
        if (f.mimeType === DOC) f.doc = newDoc();
        files.set(f.id, f); return json(200, pub(f));
      }
      const f = see(rest[0]);
      if (!f) return json(404, { error: { message: `File not found: ${rest[0]}.` } });
      if (rest[1] === 'export') return textRes(200, f.doc ? docText(f.doc) : (f.text || ''));
      if (rest[1] === 'copy' && method === 'POST') { const c = { ...f, id: id(), name: body.name || `Copy of ${f.name}`, parents: [...f.parents], visible: true, doc: f.doc && structuredClone(f.doc) }; files.set(c.id, c); return json(200, pub(c)); }
      if (method === 'GET') return json(200, pub(f));
      if (method === 'PATCH') {
        if (body.name !== undefined) f.name = body.name;
        if (body.trashed !== undefined) f.trashed = body.trashed;
        const add = u.searchParams.get('addParents'), rem = u.searchParams.get('removeParents');
        if (rem) f.parents = f.parents.filter(p => !rem.split(',').includes(p));
        if (add) for (const p of add.split(',')) if (!f.parents.includes(resolve(p))) f.parents.push(resolve(p));
        return json(200, pub(f));
      }
      return json(405, { error: { message: 'method not allowed' } });
    }
  };
  // ---------- Google Docs: a flat token model with real Docs index rules ----------
  // Each token is one index: a character ({ ch, ts: text style }), or a table
  // marker ('T' table start, 'R' row start, 'C' cell start). A paragraph's style
  // and bullet live on its '\n'. Index 1 is tokens[0].
  function docsApi(u, method, body) {
    const m = u.pathname.match(/^\/v1\/documents\/([^/:]+)(:batchUpdate)?$/);
    const f = m && see(m[1]);
    if (!f || !f.doc) return json(404, { error: { message: 'Requested entity was not found.' } });
    if (method === 'GET' && !m[2]) return json(200, render(f));
    if (method === 'POST' && m[2]) {
      const replies = [];
      try { for (const r of body.requests) replies.push(apply(f.doc, r)); }
      catch (e) { return json(400, { error: { message: e.message } }); }
      fake.docRequests.push(...body.requests);
      return json(200, { documentId: f.id, replies });
    }
    return json(405, { error: { message: 'no' } });
  }
  fake.fetchImpl = (u, o) => fake.fetch(u, o);
  return fake;
}

const DOC = 'application/vnd.google-apps.document';
const nl = () => ({ ch: '\n', ts: {}, ps: { namedStyleType: 'NORMAL_TEXT' } });
function newDoc() { return { tokens: [nl()], lists: {} }; }
function docText(doc) { return doc.tokens.filter(t => typeof t === 'object').map(t => t.ch).join(''); }
function apply(doc, r) {
  const T = doc.tokens, at = i => { if (i < 1 || i > T.length) throw new Error(`Index ${i} must be less than the end index of the referenced segment, ${T.length + 1}.`); return i - 1; };
  // every paragraph that overlaps [s, e): scan from s, and stop once the next paragraph starts at or after e
  const paraRange = (s, e) => { const out = []; for (let i = at(s); i < T.length; i++) { if (T[i].ch === '\n') { out.push(T[i]); if (i + 2 >= e) break; } } return out; };
  if (r.insertText) {
    const idx = r.insertText.endOfSegmentLocation ? T.length : at(r.insertText.location.index) + 1;
    const prev = T[idx - 1 - 1], style = prev && typeof prev === 'object' ? { ...prev.ts } : {};
    const following = T.slice(idx - 1).find(t => t.ch === '\n');
    T.splice(idx - 1, 0, ...[...r.insertText.text].map(ch => ch === '\n' ? { ch, ts: { ...style }, ps: { ...(following?.ps || {}) }, bullet: following?.bullet } : { ch, ts: { ...style } }));
    return {};
  }
  if (r.updateTextStyle) {
    const { startIndex: s, endIndex: e } = r.updateTextStyle.range;
    if (e <= s) throw new Error('The range should not be empty.');
    if (e > T.length) throw new Error('The range cannot include the final newline.');
    for (let i = at(s); i < e - 1; i++) { const t = T[i]; if (typeof t !== 'object') continue; for (const k of r.updateTextStyle.fields.split(',')) { if (r.updateTextStyle.textStyle[k] === undefined) delete t.ts[k]; else t.ts[k] = r.updateTextStyle.textStyle[k]; } }
    return {};
  }
  if (r.updateParagraphStyle) { const { startIndex: s, endIndex: e } = r.updateParagraphStyle.range; for (const t of paraRange(s, e)) t.ps = { ...t.ps, namedStyleType: r.updateParagraphStyle.paragraphStyle.namedStyleType }; return {}; }
  if (r.deleteParagraphBullets) { const { startIndex: s, endIndex: e } = r.deleteParagraphBullets.range; for (const t of paraRange(s, e)) delete t.bullet; return {}; }
  if (r.createParagraphBullets) {
    const { startIndex: s, endIndex: e } = r.createParagraphBullets.range, listId = `kix.list${Object.keys(doc.lists).length + 1}`;
    doc.lists[listId] = { listProperties: { nestingLevels: [r.createParagraphBullets.bulletPreset.startsWith('NUMBERED') ? { glyphType: 'DECIMAL' } : { glyphSymbol: '●' }] } };
    for (const t of paraRange(s, e)) t.bullet = { listId };
    return {};
  }
  if (r.insertTable) {
    const { rows, columns } = r.insertTable, cells = [];
    for (let i = 0; i < rows; i++) { cells.push('R'); for (let j = 0; j < columns; j++) cells.push('C', nl()); }
    // Docs splits the last paragraph with a newline before the table: both halves keep its style and bullet
    const last = T[T.length - 1];
    T.splice(T.length - 1, 0, { ch: '\n', ts: {}, ps: { ...last.ps }, ...(last.bullet ? { bullet: last.bullet } : {}) }, 'T', ...cells, 'E');
    return {};
  }
  if (r.replaceAllText) {
    const find = r.replaceAllText.containsText.text, rep = r.replaceAllText.replaceText;
    let n = 0;
    for (let i = 0; i + find.length <= T.length; i++) {
      if (T.slice(i, i + find.length).map(t => t.ch).join('') !== find) continue;
      const ts = { ...T[i].ts };
      T.splice(i, find.length, ...[...rep].map(ch => ({ ch, ts: { ...ts } })));
      i += rep.length - 1; n++;
    }
    return { replaceAllText: { occurrencesChanged: n } };
  }
  throw new Error(`The fake doesn't know ${Object.keys(r)[0]}`);
}
/** Turn the tokens into the shape documents.get returns. */
function render(f) {
  const T = f.doc.tokens, content = [{ endIndex: 1, sectionBreak: {} }];
  let i = 0;
  const para = () => {
    const s = i, els = []; let run = null;
    for (; i < T.length; i++) {
      const t = T[i];
      if (!run || JSON.stringify(run.ts) !== JSON.stringify(t.ts)) { run = { ts: t.ts, s: i, text: '' }; els.push(run); }
      run.text += t.ch;
      if (t.ch === '\n') { i++; break; }
    }
    const end = T[i - 1];
    return { startIndex: s + 1, endIndex: i + 1, paragraph: { elements: els.map(r => ({ startIndex: r.s + 1, endIndex: r.s + 1 + r.text.length, textRun: { content: r.text, textStyle: r.ts } })), paragraphStyle: { ...end.ps }, ...(end.bullet ? { bullet: end.bullet } : {}) } };
  };
  while (i < T.length) {
    if (T[i] === 'T') {
      const s = i; i++; const rows = [];
      while (T[i] === 'R') { i++; const cells = []; while (T[i] === 'C') { const cs = i; i++; const c = []; while (typeof T[i] === 'object') c.push(para()); cells.push({ startIndex: cs + 1, content: c }); } rows.push({ tableCells: cells }); }
      i++;   // 'E'
      content.push({ startIndex: s + 1, endIndex: i + 1, table: { rows: rows.length, columns: rows[0].tableCells.length, tableRows: rows } });
    } else content.push(para());
  }
  return { documentId: f.id, title: f.name, body: { content }, lists: f.doc.lists };
}
export { DOC };

