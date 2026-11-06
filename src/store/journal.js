// Run journal: every event of a run, appended to data/runs/<runId>.ndjson.
//
// Writes are batched: lines queue in memory and a flush (append + fsync)
// runs every `flushMs`, plus immediately whenever a run ends. If the process
// dies mid-run, the file holds complete lines up to the last flush, at most
// one torn line (skipped on read), and no run.end. recover() finds those runs.

import path from 'node:path';
import { appendDurable, parseNdjson } from './durable.js';

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

export function makeJournal({ fsp, dir, flushMs = 200, setTimer = setTimeout }) {
  const pending = new Map(); // runId -> string[]
  const checked = new Set(); // files whose tail we've checked this process
  let timer = null, chain = Promise.resolve();

  // After a crash a file can end in a torn line. Start our first append on a
  // fresh line so the torn fragment can't swallow a good event.
  async function needsNewline(file) {
    let fh;
    try {
      fh = await fsp.open(file, 'r');
      const { size } = await fh.stat(); if (!size) return false;
      const b = Buffer.alloc(1); await fh.read(b, 0, 1, size - 1);
      return b[0] !== 0x0a;
    } catch (e) { if (e.code === 'ENOENT') return false; throw e; } finally { await fh?.close(); }
  }

  const fileOf = runId => {
    if (!SAFE_ID.test(runId)) throw new Error(`bad run id: ${runId}`);
    return path.join(dir, `${runId}.ndjson`);
  };

  function flush() {
    timer = null;
    const batch = [...pending.entries()]; pending.clear();
    chain = chain.then(async () => {
      for (const [runId, lines] of batch) {
        const file = fileOf(runId);
        let text = lines.join('');
        if (!checked.has(file)) { checked.add(file); if (await needsNewline(file)) text = '\n' + text; }
        await appendDurable(fsp, file, text);
      }
    }).catch(err => { console.error('[journal] flush failed:', err.message); });
    return chain;
  }

  return {
    async init() { await fsp.mkdir(dir, { recursive: true }); },
    append(event) {
      const lines = pending.get(event.runId) || [];
      lines.push(JSON.stringify(event) + '\n');
      pending.set(event.runId, lines);
      if (event.type === 'run.end') return flush();
      if (!timer) timer = setTimer(flush, flushMs);
      return chain;
    },
    flush,
    async read(runId) {
      try { return parseNdjson(await fsp.readFile(fileOf(runId), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    },
    async list() {
      let names = [];
      try { names = await fsp.readdir(dir); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      return names.filter(n => n.endsWith('.ndjson')).map(n => n.slice(0, -7));
    },
    /** The events of the newest `limit` runs (by file time), oldest first, with a worker kept beside its lead. */
    async history(limit = 30) {
      const ids = await this.list(), stamped = [];
      for (const id of ids) { try { stamped.push([id, (await fsp.stat(fileOf(id))).mtimeMs]); } catch {} }
      stamped.sort((a, b) => b[1] - a[1]);
      const evs = [];
      for (const [id] of stamped.slice(0, limit)) evs.push(...await this.read(id));
      return evs.sort((a, b) => (a.ts - b.ts) || (a.seq - b.seq));
    },
    /** Runs that started but never ended (the process died). Returns [{ runId, agentId, lastSeq, provider }]. */
    async unfinished() {
      const out = [];
      for (const runId of await this.list()) {
        const evs = await this.read(runId);
        const start = evs.find(e => e.type === 'run.start');
        if (!start || evs.some(e => e.type === 'run.end')) continue;
        out.push({ runId, agentId: start.agentId, provider: start.provider, lastSeq: Math.max(...evs.map(e => e.seq)) });
      }
      return out;
    }
  };
}
