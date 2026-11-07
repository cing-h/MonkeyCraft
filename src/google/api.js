// One small caller for Google's REST APIs. It adds the sign-in, retries once
// with a fresh sign-in after a 401, waits and retries once after a rate limit,
// and turns Google's errors into plain sentences. It throws GoogleApiError
// (the tool pipeline catches it and reports it).

export class GoogleApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

const PLAIN = {
  400: 'Google said the request was wrong',
  403: "Google said MonkeyCraft isn't allowed to do that (it can only touch files it made or that you opened with it)",
  404: "Google couldn't find that file (or MonkeyCraft isn't allowed to see it)",
  429: 'Google says MonkeyCraft is going too fast; try again in a minute'
};

export function makeGoogleApi({ auth, fetchImpl, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  async function call(method, url, { query, body, raw = false, signal } = {}) {
    const u = new URL(url);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    let force = false, waited = false;
    for (;;) {
      const tok = await auth.accessToken({ force });
      const res = await fetchImpl(u, {
        method, signal,
        headers: { authorization: `Bearer ${tok}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
      if (res.status === 401 && !force) { force = true; continue; }
      if ((res.status === 429 || res.status === 503) && !waited) { waited = true; await sleep(2000); continue; }
      if (raw && res.ok) return await res.text();
      let data = null; const text = await res.text();
      try { data = text ? JSON.parse(text) : {}; } catch { data = { text }; }
      if (!res.ok) {
        const detail = data?.error?.message || (typeof data?.error === 'string' ? data.error : '') || '';
        throw new GoogleApiError(`${PLAIN[res.status] || `Google said ${res.status}`}${detail ? ` (${detail.slice(0, 300)})` : ''}.`, res.status);
      }
      return data;
    }
  }
  return { call };
}
