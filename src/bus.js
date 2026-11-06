// Event bus. Every producer emits through here, so every event is validated
// against the frozen contract, numbered per run, journaled, and fanned out to
// live subscribers (the SSE hub). An invalid event is dropped and logged and
// never thrown, because a bug in one producer must not crash a run.

import { makeEvent } from './events.js';

export function makeBus({ clock, journal, log = () => {}, keep = 3000 }) {
  const subs = new Set(), seqs = new Map(), recent = [];

  function emitFor(runId, agentId, startSeq) {
    if (startSeq !== undefined && !seqs.has(runId)) seqs.set(runId, startSeq);
    return (type, payload) => {
      const seq = seqs.get(runId) ?? 0;
      const r = makeEvent(type, payload, { runId, agentId, seq, ts: clock.now() });
      if (!r.ok) { log(`[bus] dropped ${type}: ${r.errors.join('; ')}`); return null; }
      seqs.set(runId, seq + 1);
      if (journal) journal.append(r.event);
      recent.push(r.event); if (recent.length > keep) recent.shift();
      for (const fn of subs) { try { fn(r.event); } catch (e) { log(`[bus] subscriber failed: ${e.message}`); } }
      if (type === 'run.end') seqs.delete(runId);
      return r.event;
    };
  }

  return {
    emitFor,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    recent: () => recent.slice()
  };
}
