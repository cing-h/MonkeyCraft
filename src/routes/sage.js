// The Sage's interview panel: start it, answer or skip, finish early, then
// approve (possibly edited) or discard the draft profile (see src/crew/interview.js).

import { send } from '../http/server.js';

const reply = (res, r) => send(res, r?.error ? 409 : 200, r);

export function sageRoutes({ interview }) {
  return [
    { method: 'GET', path: '/api/sage/interview', handle: ({ res }) => send(res, 200, interview.view()) },
    { method: 'POST', path: '/api/sage/interview/start', handle: ({ res }) => reply(res, interview.start()) },
    { method: 'POST', path: '/api/sage/interview/answer', handle: ({ res, body }) => reply(res, interview.answer({ text: String(body?.text ?? ''), skip: body?.skip === true })) },
    { method: 'POST', path: '/api/sage/interview/finish', handle: ({ res }) => reply(res, interview.finish()) },
    { method: 'POST', path: '/api/sage/interview/approve', handle: async ({ res, body }) => reply(res, await interview.approve({ notes: body?.notes })) },
    { method: 'POST', path: '/api/sage/interview/discard', handle: async ({ res }) => reply(res, await interview.discard()) }
  ];
}
