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
  let failNext = null;

  const fake = {
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
    addFile({ name, mimeType, visible = false, text = '' }) { const f = { id: id(), name, mimeType, parents: [rootId], trashed: false, visible, text }; files.set(f.id, f); return f; },
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
      if (u.host !== 'www.googleapis.com' || !u.pathname.startsWith('/drive/v3/files')) return json(404, { error: { message: 'no such API in the fake' } });

      const tok = String(opts.headers?.authorization || '').replace(/^Bearer /, '');
      if (!ok(tok)) return json(401, { error: { message: 'Invalid Credentials' } });
      if (failNext) { const f = failNext; failNext = null; return json(f.status, f.body); }
      const body = opts.body ? JSON.parse(opts.body) : {};
      const rest = u.pathname.slice('/drive/v3/files'.length).split('/').filter(Boolean).map(decodeURIComponent);
      const see = fid => { const f = files.get(resolve(fid)); return f && (f.visible || f.isRoot) ? f : null; };

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
        files.set(f.id, f); return json(200, pub(f));
      }
      const f = see(rest[0]);
      if (!f) return json(404, { error: { message: `File not found: ${rest[0]}.` } });
      if (rest[1] === 'export') return textRes(200, f.text || '');
      if (rest[1] === 'copy' && method === 'POST') { const c = { ...f, id: id(), name: body.name || `Copy of ${f.name}`, parents: [...f.parents], visible: true }; files.set(c.id, c); return json(200, pub(c)); }
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
  fake.fetchImpl = (u, o) => fake.fetch(u, o);
  return fake;
}
