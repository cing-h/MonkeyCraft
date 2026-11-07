// Google connection API, used by the Settings panel:
//   GET  /api/google              is a key saved, is Google connected
//   POST /api/google/key          save the desktop-app sign-in key (the JSON file Google gives you)
//   POST /api/google/connect      returns the Google consent page to open
//   GET  /api/google/callback     Google sends the browser back here (no custom header possible)
//   POST /api/google/disconnect   forget the sign-in and tell Google to revoke it
import { send } from '../http/server.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = (res, status, title, msg) => {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'referrer-policy': 'no-referrer' });
  res.end(`<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><body style="font:16px system-ui;background:#151a14;color:#e8e4d4;padding:3em;max-width:36em"><h1 style="font-size:1.4em">${esc(title)}</h1><p>${esc(msg)}</p><p><a style="color:#9fd39a" href="/#settings">Back to MonkeyCraft</a></p></body>`);
};

export function googleRoutes({ auth }) {
  return [
    { method: 'GET', path: '/api/google', handle: ({ res }) => send(res, 200, auth.status()) },
    { method: 'POST', path: '/api/google/key', handle: async ({ res, body }) => {
      const r = await auth.saveClient(body?.key);
      if (r.error) return send(res, 400, { error: r.error });
      send(res, 200, auth.status());
    } },
    { method: 'POST', path: '/api/google/connect', handle: ({ res }) => {
      const r = auth.startConnect();
      if (r.error) return send(res, 400, { error: r.error });
      send(res, 200, r);
    } },
    { method: 'GET', path: '/api/google/callback', handle: async ({ res, url }) => {
      const p = url.searchParams;
      const r = await auth.finishConnect({ code: p.get('code'), state: p.get('state'), error: p.get('error') });
      if (r.error) return page(res, 400, "Google wasn't connected", r.error);
      page(res, 200, 'Google is connected', 'The Clerk can now work in your Google Drive, on files MonkeyCraft makes. You can close this tab.');
    } },
    { method: 'POST', path: '/api/google/disconnect', handle: async ({ res }) => { await auth.disconnect(); send(res, 200, auth.status()); } }
  ];
}
