// The council at the Ring: call one, and see when it last met (see src/crew/council.js).

import { send } from '../http/server.js';

export function councilRoutes({ council }) {
  return [
    { method: 'GET', path: '/api/council', handle: async ({ res }) => send(res, 200, await council.status()) },
    { method: 'POST', path: '/api/council', handle: async ({ res, body }) => {
      const r = await council.call({ trigger: 'user', minutes: body?.minutes ?? null });
      if (r.error) return send(res, 409, { error: r.error });
      send(res, 202, { runId: r.runId, jobs: r.jobs, minutes: r.minutes });
    } }
  ];
}
