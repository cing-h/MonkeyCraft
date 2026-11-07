// Google sign-in for MonkeyCraft (the Clerk's link to Docs, Sheets, Slides and Drive).
//
// The user makes their own Google Cloud "desktop app" sign-in key and pastes it
// into Settings. "Connect Google" then opens Google's consent page in the
// user's browser, and Google sends the browser back to MonkeyCraft's own
// localhost address (the loopback flow, with PKCE and a one-time state).
//
// Only the `drive.file` permission is asked for: MonkeyCraft sees only the
// files it made itself (or that the user opened with it). The key and the
// sign-in live in data/google/, which the crew's tools can never read
// (hardline), and are written owner-only.
//
// Injected IO only: fsp, fetchImpl, clock, randomBytes.

import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeFileDurable } from '../store/durable.js';

export const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const PENDING_MS = 10 * 60_000;
const b64url = buf => Buffer.from(buf).toString('base64url');

/** Accept the JSON Google lets you download for a desktop client ({ installed: {...} }), or { client_id, client_secret }. */
export function parseClientJson(input) {
  let j = input;
  if (typeof j === 'string') { try { j = JSON.parse(j); } catch { return { error: "That isn't valid JSON. Paste the whole file Google gave you." }; } }
  if (!j || typeof j !== 'object') return { error: 'Paste the whole sign-in key file.' };
  if (j.web) return { error: 'This key is for a "Web application". Make a "Desktop app" key instead (see the steps).' };
  const c = j.installed || j;
  const id = String(c.client_id || ''), secret = String(c.client_secret || '');
  if (!/^[A-Za-z0-9._-]{10,200}\.apps\.googleusercontent\.com$/.test(id)) return { error: 'No valid client ID was found in it (it ends in .apps.googleusercontent.com).' };
  if (!/^[A-Za-z0-9._-]{8,200}$/.test(secret)) return { error: 'No client secret was found in it.' };
  return { value: { client_id: id, client_secret: secret } };
}

export class GoogleAuthError extends Error {}
const API_KEY = /^AIza[0-9A-Za-z_-]{35}$/;

export function makeGoogleAuth({ fsp, dir, fetchImpl, clock, randomBytes, redirectUri }) {
  const clientFile = path.join(dir, 'client.json'), tokenFile = path.join(dir, 'token.json'), pickerFile = path.join(dir, 'picker.json');
  let client = null, token = null, refreshing = null, lastError = null, pickerKey = null;
  // the Google Cloud project number starts the client id; the file picker needs it as the "app id"
  const appId = () => (client?.client_id.match(/^(\d+)-/) || [])[1] || null;
  const pending = new Map();   // state -> { verifier, at }

  const writeOwner = async (file, obj) => {
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFileDurable(fsp, file, JSON.stringify(obj, null, 2) + '\n');
    try { await fsp.chmod(file, 0o600); } catch {}
  };
  const readJson = async file => { try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };

  async function tokenRequest(params) {
    const res = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
    let data = {}; try { data = await res.json(); } catch {}
    if (!res.ok) { const e = new GoogleAuthError(data.error_description || data.error || `Google said ${res.status}`); e.code = data.error; throw e; }
    return data;
  }

  async function refresh() {
    if (!client || !token?.refresh_token) throw new GoogleAuthError("Google isn't connected. Ask the user to press Connect Google in Settings.");
    try {
      const d = await tokenRequest({ grant_type: 'refresh_token', refresh_token: token.refresh_token, client_id: client.client_id, client_secret: client.client_secret });
      token = { ...token, access_token: d.access_token, expires_at: clock.now() + (Number(d.expires_in) || 3600) * 1000 };
      await writeOwner(tokenFile, token);
      lastError = null;
      return token.access_token;
    } catch (e) {
      if (e.code === 'invalid_grant') {   // revoked, expired (7 days in "Testing" mode) or the key was deleted
        token = null; try { await fsp.unlink(tokenFile); } catch {}
        lastError = 'Google ended the sign-in (it was revoked or expired). Press Connect Google again.';
        throw new GoogleAuthError(`Google isn't connected any more: ${lastError}`);
      }
      throw e;
    }
  }

  return {
    async load() {
      try { const c = await readJson(clientFile); if (c) { const p = parseClientJson(c); client = p.value || null; } token = await readJson(tokenFile); const pk = await readJson(pickerFile); pickerKey = pk && API_KEY.test(pk.apiKey || '') ? pk.apiKey : null; return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    },
    status: () => ({ hasKey: !!client, connected: !!(client && token?.refresh_token), connectedAt: token?.connectedAt || null, lastError, redirectUri, scope: SCOPE, hasPickerKey: !!pickerKey && !!appId() }),
    /** The file picker's API key (Google Cloud → Credentials → API key). */
    async savePickerKey(key) {
      const k = String(key || '').trim();
      if (!API_KEY.test(k)) return { error: "That doesn't look like a Google API key (it starts with AIza and is 39 characters)." };
      if (!appId()) return { error: 'Save the sign-in key first: the picker needs the project number in it.' };
      pickerKey = k; await writeOwner(pickerFile, { apiKey: k });
      return { ok: true };
    },
    /** What the picker page needs: a fresh access token (drive.file only), the API key and the app id. */
    async pickerSession() {
      if (!pickerKey || !appId()) return { error: 'The file picker isn\'t set up: add the API key in Settings.' };
      try { return { token: await this.accessToken(), apiKey: pickerKey, appId: appId() }; }
      catch (e) { return { error: e.message }; }
    },
    async saveClient(input) {
      const p = parseClientJson(input);
      if (p.error) return p;
      const changed = !client || client.client_id !== p.value.client_id;
      client = p.value; await writeOwner(clientFile, client);
      if (changed && token) { token = null; try { await fsp.unlink(tokenFile); } catch {} }   // a sign-in belongs to the key that made it
      return { ok: true };
    },
    /** Step 1: the address to open in the user's browser. */
    startConnect() {
      if (!client) return { error: 'Paste your Google sign-in key first.' };
      const now = clock.now();
      for (const [s, p] of pending) if (now - p.at > PENDING_MS) pending.delete(s);
      const state = b64url(randomBytes(24)), verifier = b64url(randomBytes(48));
      pending.set(state, { verifier, at: now });
      const q = new URLSearchParams({
        client_id: client.client_id, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE,
        access_type: 'offline', prompt: 'consent', state,
        code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256'
      });
      return { url: `${AUTH_URL}?${q}` };
    },
    /** Step 2: Google sent the browser back with ?code&state (or ?error). */
    async finishConnect({ code, state, error }) {
      const p = state && pending.get(state);
      if (!p || clock.now() - p.at > PENDING_MS) return { error: 'This sign-in link is old or unknown. Press Connect Google again.' };
      pending.delete(state);
      if (error) return { error: error === 'access_denied' ? 'You said no on the Google page, so nothing was connected.' : `Google said: ${error}` };
      if (!code) return { error: 'Google sent no sign-in code back.' };
      try {
        const d = await tokenRequest({ grant_type: 'authorization_code', code, code_verifier: p.verifier, redirect_uri: redirectUri, client_id: client.client_id, client_secret: client.client_secret });
        const granted = String(d.scope || '').split(' ');
        if (!granted.includes(SCOPE)) return { error: 'Google didn\'t grant access to MonkeyCraft\'s files. Try again and tick the box on the Google page.' };
        if (!d.refresh_token) return { error: 'Google sent no lasting sign-in. Remove MonkeyCraft at myaccount.google.com/permissions, then connect again.' };
        token = { refresh_token: d.refresh_token, access_token: d.access_token, expires_at: clock.now() + (Number(d.expires_in) || 3600) * 1000, connectedAt: clock.now() };
        await writeOwner(tokenFile, token);
        lastError = null;
        return { ok: true };
      } catch (e) { return { error: `Google refused the sign-in: ${e.message}` }; }
    },
    /** A valid access token, refreshed when it's within a minute of expiring. One refresh at a time. */
    async accessToken({ force = false } = {}) {
      if (!force && token?.access_token && token.expires_at - 60_000 > clock.now()) return token.access_token;
      if (!refreshing) refreshing = refresh().finally(() => { refreshing = null; });
      return refreshing;
    },
    async disconnect() {
      const t = token; token = null;
      try { await fsp.unlink(tokenFile); } catch {}
      if (t?.refresh_token) { try { await fetchImpl(`${REVOKE_URL}?token=${encodeURIComponent(t.refresh_token)}`, { method: 'POST' }); } catch {} }
      return { ok: true };
    }
  };
}
