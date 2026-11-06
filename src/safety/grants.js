// Remembered answers ("grants"). A grant lets one exact action (its cache key,
// such as "this command in this folder" or "writing this file") run again
// without asking. Session grants last until MonkeyCraft restarts. "Always"
// grants are saved durably in data/grants.json, which is hardlined, so no
// creature can read or forge them. The consent broker never uses a grant
// outside the workspace: there, it asks every time.
//
// Injected IO only (fsp, clock).

import { writeFileDurable } from '../store/durable.js';

const MAX_GRANTS = 500;

export function makeGrantStore({ fsp, file, clock }) {
  const session = new Set();
  let always = new Map(); // key -> { key, tool, summary, ts }
  let chain = Promise.resolve();
  const save = () => (chain = chain.then(() => writeFileDurable(fsp, file, JSON.stringify({ v: 1, grants: [...always.values()] }, null, 1) + '\n')));

  return {
    /** Load saved grants. A missing file is fine; a corrupt one is ignored and reported. */
    async load() {
      try {
        const d = JSON.parse(await fsp.readFile(file, 'utf8'));
        always = new Map((Array.isArray(d.grants) ? d.grants : []).filter(g => g && typeof g.key === 'string').slice(0, MAX_GRANTS).map(g => [g.key, g]));
        return { ok: true, count: always.size };
      } catch (e) {
        if (e.code === 'ENOENT') return { ok: true, count: 0 };
        always = new Map();
        return { ok: false, error: e.message };
      }
    },
    /** 'always' | 'session' | null */
    kind: key => (always.has(key) ? 'always' : session.has(key) ? 'session' : null),
    addSession(key) { session.add(key); },
    async addAlways({ key, tool, summary }) {
      if (always.size >= MAX_GRANTS && !always.has(key)) return false;
      always.set(key, { key, tool: String(tool || ''), summary: String(summary || '').slice(0, 300), ts: clock.now() });
      await save(); return true;
    },
    list: () => [...always.values()].sort((a, b) => b.ts - a.ts),
    /** Forget a remembered answer (both kinds). */
    async forget(key) {
      const had = always.delete(key); const hadS = session.delete(key);
      if (had) await save();
      return had || hadS;
    },
    clearSession() { session.clear(); },
    flush: () => chain
  };
}
