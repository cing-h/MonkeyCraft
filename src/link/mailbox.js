// The Chief's mailbox: requests from the Chief to an outside Claude Code
// session, and that session's replies. Durable (data/mailbox.json), so a
// request or an answer survives a restart.
//
// A request is information for the session, never an order: the session reads
// it, does the work under its own permission prompts, and replies. Requests
// that trace back to web content are marked `untrusted`.
//
// After a restart, the job that asked has ended, so its waiting requests are
// marked `askerEnded`. The session may still answer them (the answer is kept
// and shown in the Job log), but nobody is waiting for it.
//
// Injected: fsp, file, clock, newId. Never throws from its public methods.

import { writeFileDurable } from '../store/durable.js';

export const MAX_REQUEST = 8000, MAX_REPLY = 20_000, MAX_WAITING = 20, KEEP = 200;

export function makeMailbox({ fsp, file, clock, newId, log = () => {} }) {
  let items = [];          // oldest first
  const waiters = new Set();   // { match(item) -> bool, resolve }
  let saving = Promise.resolve();

  const save = () => (saving = saving.then(() => writeFileDurable(fsp, file, JSON.stringify({ v: 1, items }, null, 1))).catch(e => log(`[mailbox] save failed: ${e.message}`)));
  const wake = item => { for (const w of [...waiters]) if (w.match(item)) { waiters.delete(w); w.resolve(item); } };
  const copy = i => i && { ...i };
  const wait = (match, ms, signal) => new Promise(resolve => {
    const w = { match, resolve: v => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve(v); } };
    const onAbort = () => { waiters.delete(w); w.resolve(null); };
    const timer = setTimeout(onAbort, Math.max(0, ms));
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    waiters.add(w);
  });

  return {
    /** Read the saved mailbox. Waiting requests from before the restart are marked askerEnded. */
    async load() {
      try {
        const d = JSON.parse(await fsp.readFile(file, 'utf8'));
        items = Array.isArray(d.items) ? d.items.filter(i => i && typeof i.id === 'string') : [];
        let changed = false;
        for (const i of items) if (i.status === 'waiting' && !i.askerEnded) { i.askerEnded = true; changed = true; }
        if (changed) await save();
        return { ok: true };
      } catch (e) { items = []; return e.code === 'ENOENT' ? { ok: true } : { ok: false, error: e.message }; }
    },

    /** The Chief asks. Returns { item } or { error }. */
    async ask({ fromRunId, agentId, request, untrusted = false }) {
      const text = String(request ?? '').trim();
      if (!text) return { error: 'The request is empty.' };
      if (text.length > MAX_REQUEST) return { error: `The request is too long (${MAX_REQUEST} characters max).` };
      if (items.filter(i => i.status === 'waiting').length >= MAX_WAITING) return { error: `${MAX_WAITING} requests are already waiting for Claude Code. Wait for answers first.` };
      const item = { id: newId('ask'), fromRunId, agentId, request: text, untrusted: !!untrusted, status: 'waiting', askedAt: clock.now(), reply: null, repliedAt: null, askerEnded: false };
      items.push(item);
      if (items.length > KEEP) items = items.filter((i, n) => i.status === 'waiting' || n >= items.length - KEEP);
      await save();
      wake(item);
      return { item: copy(item) };
    },

    /** The outside session answers. Returns { item } or { error }. */
    async reply(id, text) {
      const item = items.find(i => i.id === id);
      if (!item) return { error: `There is no request "${id}".` };
      if (item.status !== 'waiting') return { error: 'That request was already answered or closed.' };
      const t = String(text ?? '').trim();
      if (!t) return { error: 'The reply is empty.' };
      if (t.length > MAX_REPLY) return { error: `The reply is too long (${MAX_REPLY} characters max).` };
      Object.assign(item, { status: 'answered', reply: t, repliedAt: clock.now() });
      await save();
      wake(item);
      return { item: copy(item) };
    },


    /** Mark the requests of a job that has ended: nobody waits for their answer any more. */
    askerEnded(runId) { let n = 0; for (const i of items) if (i.fromRunId === runId && i.status === 'waiting' && !i.askerEnded) { i.askerEnded = true; n++; } if (n) save(); return n; },

    get: id => copy(items.find(i => i.id === id)),
    waiting: () => items.filter(i => i.status === 'waiting').map(copy),
    recent: (n = 20) => items.slice(-n).map(copy),

    /** Wait until request `id` is answered or closed (or `ms` passes, or `signal` aborts). Resolves the item or null. */
    waitForAnswer(id, ms, signal) {
      const now = items.find(i => i.id === id);
      if (!now) return Promise.resolve(null);
      if (now.status !== 'waiting') return Promise.resolve(copy(now));
      return wait(i => i.id === id && i.status !== 'waiting', ms, signal).then(copy);
    },

    /** Wait until there is any waiting request (for the session's watcher). Resolves the list, or [] after `ms`. */
    async waitForMail(ms, signal) {
      if (items.some(i => i.status === 'waiting')) return this.waiting();
      await wait(i => i.status === 'waiting', ms, signal);
      return this.waiting();
    },

    flush: () => saving
  };
}
