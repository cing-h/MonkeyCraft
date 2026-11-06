// The app's own API, used by the browser UI.

import { send } from '../http/server.js';

export function apiRoutes({ bus, runs, consent, grants, roster, journal, ledger, clock, limits }) {
  return [
    { method: 'GET', path: '/api/roster', handle: ({ res }) => send(res, 200, { crew: roster.public() }) },

    { method: 'POST', path: '/api/run', handle: ({ res, body }) => {
      const r = runs.start({ agentId: body.agentId, prompt: body.prompt, allowOverDaily: body.allowOverDaily === true });
      if (r.error) return send(res, r.code === 'daily_cap' ? 409 : 400, { error: r.error, code: r.code || null });
      send(res, 202, { runId: r.runId });
    } },

    { method: 'POST', path: '/api/permission', handle: ({ res, body }) => {
      const ok = consent.respond(String(body.promptId || ''), String(body.decision || ''));
      send(res, ok ? 200 : 404, ok ? { ok } : { error: 'That question was already answered or has expired.' });
    } },

    { method: 'POST', path: '/api/halt', handle: ({ res }) => send(res, 200, { stopped: runs.halt('user') }) },

    { method: 'POST', path: /^\/api\/runs\/([A-Za-z0-9_-]+)\/revert$/, handle: async ({ res, params }) => {
      const r = await runs.revert(params[0]);
      send(res, r.error ? 409 : 200, r);
    } },

    // remembered answers ("Always allow"), listed and forgettable
    { method: 'GET', path: '/api/grants', handle: ({ res }) => send(res, 200, { grants: grants.list() }) },
    { method: 'POST', path: '/api/grants/forget', handle: async ({ res, body }) => send(res, 200, { forgotten: await grants.forget(String(body.key || '')) }) },

    { method: 'POST', path: /^\/api\/runs\/([A-Za-z0-9_-]+)\/cancel$/, handle: ({ res, params }) => send(res, runs.cancel(params[0]) ? 200 : 404, {}) },

    { method: 'GET', path: '/api/runs', handle: async ({ res }) => send(res, 200, { active: runs.active(), all: await journal.list() }) },

    { method: 'GET', path: /^\/api\/runs\/([A-Za-z0-9_-]+)$/, handle: async ({ res, params }) => send(res, 200, { events: await journal.read(params[0]) }) },

    { method: 'GET', path: '/api/spend', handle: async ({ res }) => {
      const d = new Date(clock.now()); d.setHours(0, 0, 0, 0);
      send(res, 200, { today: await ledger.totals(d.getTime()), limits: { dailyUsd: limits.dailyUsd, perRunUsd: limits.perRunUsd, perRunTokens: limits.perRunTokens } });
    } },

    // Live events (Server-Sent Events). On connect, replays this session's recent events.
    { method: 'GET', path: '/api/events', handle: ({ req, res }) => {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
      const write = ev => res.write(`data: ${JSON.stringify(ev)}\n\n`);
      for (const ev of bus.recent()) write(ev);
      res.write(`event: ready\ndata: {}\n\n`);
      const off = bus.subscribe(write);
      const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
      req.on('close', () => { off(); clearInterval(ping); });
    } }
  ];
}
