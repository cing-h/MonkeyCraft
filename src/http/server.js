// The sidecar's HTTP server, bound to 127.0.0.1 only.
//
// Guards for a server on localhost:
// - Host must be 127.0.0.1:<port> or localhost:<port> (blocks DNS rebinding).
// - Every state-changing /api request needs the header `X-AutoCraft: 1`. A
//   custom header forces a CORS preflight that this server never approves,
//   so another website can't start jobs or answer prompts.
// - /mcp/* needs the run's secret bearer token (checked by the route).

import http from 'node:http';

export function makeServer({ port, routes, log = console.log }) {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  const server = http.createServer(async (req, res) => {
    try {
      if (!allowedHosts.has(req.headers.host || '')) return send(res, 421, { error: 'wrong host' });
      if (req.method === 'OPTIONS') return send(res, 403, { error: 'no cross-origin access' });
      const url = new URL(req.url, `http://${req.headers.host}`);
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.path instanceof RegExp ? url.pathname.match(r.path) : (url.pathname === r.path ? [] : null);
        if (!m) continue;
        if (r.guard !== false && req.method !== 'GET' && req.headers['x-autocraft'] !== '1') return send(res, 403, { error: 'missing X-AutoCraft header' });
        const body = (req.method === 'POST') ? await readJson(req) : undefined;
        if (body === BAD) return send(res, 400, { error: 'body must be JSON (max 1 MB)' });
        return await r.handle({ req, res, url, params: m.slice(1), body });
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      log(`[http] ${req.method} ${req.url} failed: ${e.stack || e.message}`);
      if (!res.headersSent) send(res, 500, { error: 'internal error' }); else res.end();
    }
  });
  server.requestTimeout = 0; // MCP tool calls may wait a long time for the user's permission
  server.headersTimeout = 30_000;
  return {
    listen: () => new Promise((ok, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', () => ok(server)); }),
    close: () => new Promise(ok => { server.closeAllConnections?.(); server.close(() => ok()); })
  };
}

const BAD = Symbol('bad');
function readJson(req, limit = 1_000_000) {
  return new Promise(resolve => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { req.destroy(); resolve(BAD); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve(BAD); }
    });
    req.on('error', () => resolve(BAD));
  });
}

export function send(res, status, obj, headers = {}) {
  const body = obj === undefined ? '' : JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body);
}
