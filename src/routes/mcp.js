// Streamable-HTTP MCP endpoint, one URL per run: POST /mcp/<runId>.
// Claude Code sends JSON-RPC; we answer with plain JSON (no server-initiated stream).

import { send } from '../http/server.js';
import { handleMcp } from '../mcp/handler.js';

export function mcpRoutes({ runs }) {
  const auth = (req, runId) => {
    const h = req.headers.authorization || '';
    return runs.mcpContext(runId, h.startsWith('Bearer ') ? h.slice(7) : '');
  };
  return [
    { method: 'POST', path: /^\/mcp\/([A-Za-z0-9_-]+)$/, guard: false, handle: async ({ req, res, params, body }) => {
      const ctx = auth(req, params[0]);
      if (!ctx) return send(res, 401, { error: 'unknown run or bad token' });
      if (Array.isArray(body)) {
        const out = (await Promise.all(body.map(m => handleMcp(m, ctx)))).filter(Boolean);
        return out.length ? send(res, 200, out) : send(res, 202);
      }
      const r = await handleMcp(body, ctx);
      return r ? send(res, 200, r) : send(res, 202);
    } },
    // We don't offer a server-to-client stream or sessions.
    { method: 'GET', path: /^\/mcp\/([A-Za-z0-9_-]+)$/, handle: ({ res }) => send(res, 405, { error: 'no stream' }, { allow: 'POST' }) },
    { method: 'DELETE', path: /^\/mcp\/([A-Za-z0-9_-]+)$/, guard: false, handle: ({ res }) => send(res, 405, { error: 'no sessions' }, { allow: 'POST' }) }
  ];
}
