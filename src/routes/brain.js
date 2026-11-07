// The Brain panel's API: browse, read, search and see the history of the Brain,
// and undo, lock or archive. Everything here acts as the user.

import { send } from '../http/server.js';

const reply = (res, r) => send(res, r.error ? (r.error === 'no such note' || r.error === 'no such change' ? 404 : 409) : 200, r);

export function brainRoutes({ brain }) {
  return [
    { method: 'GET', path: '/api/brain', handle: ({ res }) => send(res, 200, brain.status()) },
    { method: 'GET', path: '/api/brain/notes', handle: async ({ res, url }) => reply(res, await brain.list({ area: url.searchParams.get('area') || undefined })) },
    { method: 'GET', path: '/api/brain/note', handle: async ({ res, url }) => reply(res, await brain.read({ rel: url.searchParams.get('path') || '' })) },
    { method: 'GET', path: '/api/brain/search', handle: async ({ res, url }) => reply(res, await brain.search({ q: url.searchParams.get('q') || '', limit: 20 })) },
    { method: 'GET', path: '/api/brain/history', handle: async ({ res }) => reply(res, await brain.history({ limit: 100 })) },
    { method: 'POST', path: '/api/brain/undo', handle: async ({ res, body }) => reply(res, await brain.undo({ changeId: String(body?.changeId || ''), by: 'user' })) },
    { method: 'POST', path: '/api/brain/archive', handle: async ({ res, body }) => reply(res, await brain.archive({ rel: String(body?.path || ''), by: 'user' })) },
    { method: 'POST', path: '/api/brain/lock', handle: async ({ res, body }) => {
      const line = body?.line === undefined || body?.line === null ? undefined : Number(body.line);
      reply(res, await brain.lock({ rel: String(body?.path || ''), locked: body?.locked === true, line }));
    } }
  ];
}
