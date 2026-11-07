// Undo copies. Before a tool changes a file, the file's old bytes (or the fact
// that it didn't exist yet) are saved under data/undo/<runId>/, with one index
// line per change. After the change, the new content's hash is recorded.
//
// "Revert this job" undoes every change in reverse order. It skips a file that
// was changed again afterwards (its hash no longer matches), so it never
// overwrites newer work. Shell commands can't be undone this way, which is why
// they always show the exact command before running.
//
// Injected IO only (fsp, newId, clock).

import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeFileDurable, appendDurable, parseNdjson } from './durable.js';

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
export const sha256 = b => createHash('sha256').update(b).digest('hex');

export function makeUndoStore({ fsp, dir, newId, clock }) {
  const runDir = runId => { if (!SAFE_ID.test(runId)) throw new Error(`bad run id: ${runId}`); return path.join(dir, runId); };
  const index = runId => path.join(runDir(runId), 'index.ndjson');

  async function records(runId) {
    let lines = [];
    try { lines = parseNdjson(await fsp.readFile(index(runId), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const byId = new Map();
    for (const l of lines) { if (!l || !SAFE_ID.test(l.undoId || '')) continue; byId.set(l.undoId, { ...(byId.get(l.undoId) || {}), ...l }); }
    return [...byId.values()];
  }

  return {
    /** Before a change: save the old bytes. Returns { undoId, existed }. */
    async save({ runId, path: file, op }) {
      const undoId = newId('undo'), d = runDir(runId);
      await fsp.mkdir(d, { recursive: true });
      let existed = false;
      try { const b = await fsp.readFile(file); existed = true; await writeFileDurable(fsp, path.join(d, undoId + '.bak'), b); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
      await appendDurable(fsp, index(runId), JSON.stringify({ undoId, path: file, op, existed, ts: clock.now() }) + '\n');
      return { undoId, existed };
    },
    /** After the change: record what the file now holds. */
    async settle(runId, undoId, bytes) {
      await appendDurable(fsp, index(runId), JSON.stringify({ undoId, afterHash: sha256(bytes) }) + '\n');
    },
    /** Before a move: record where it came from (nothing to copy; reverting moves it back). */
    async saveMove({ runId, from, to }) {
      const undoId = newId('undo');
      await fsp.mkdir(runDir(runId), { recursive: true });
      await appendDurable(fsp, index(runId), JSON.stringify({ undoId, path: to, from, op: 'move', existed: false, ts: clock.now() }) + '\n');
      return { undoId };
    },
    async settleMove(runId, undoId) { await appendDurable(fsp, index(runId), JSON.stringify({ undoId, moved: true }) + '\n'); },
    /**
     * A change outside this computer (Google Drive). `label` is what the user sees,
     * `remote` is what the reverter needs. Settle it once the change really happened.
     */
    async saveRemote({ runId, label, remote }) {
      const undoId = newId('undo');
      await fsp.mkdir(runDir(runId), { recursive: true });
      await appendDurable(fsp, index(runId), JSON.stringify({ undoId, path: label, op: 'remote', remote, existed: false, ts: clock.now() }) + '\n');
      return { undoId };
    },
    /** `remote`, if given, replaces the saved one (for facts only known afterwards, such as a new file's id). */
    async settleRemote(runId, undoId, remote) { await appendDurable(fsp, index(runId), JSON.stringify({ undoId, done: true, ...(remote ? { remote } : {}) }) + '\n'); },
    async list(runId) { return (await records(runId)).filter(r => r.path); },
    /**
     * Undo a job's changes, newest first. `guard(path)` returns a reason the path
     * may no longer be touched (hardline), or null. Returns [{ undoId, path, result }],
     * where result is 'restored' | 'removed' | 'moved back' | 'binned' | 'skipped: …'.
     * `remote(record)` undoes a Google change (see src/google/drive.js).
     */
    async revert(runId, { guard, remote }) {
      const out = [];
      for (const r of (await records(runId)).filter(x => x.path).reverse()) {
        const res = { undoId: r.undoId, path: r.path };
        if (r.reverted) { out.push({ ...res, result: 'skipped: already reverted' }); continue; }
        if (r.op === 'remote') {
          if (!r.done) { out.push({ ...res, result: 'skipped: the change never finished' }); continue; }
          if (!remote) { out.push({ ...res, result: "skipped: Google isn't available" }); continue; }
          let result;
          try { result = await remote(r); } catch (e) { result = `skipped: ${e.message}`; }
          if (!result.startsWith('skipped')) await appendDurable(fsp, index(runId), JSON.stringify({ undoId: r.undoId, reverted: true, revertedAt: clock.now() }) + '\n');
          out.push({ ...res, result }); continue;
        }
        if (r.op === 'move') {
          if (!r.moved) { out.push({ ...res, result: 'skipped: the move never finished' }); continue; }
          const why = (await guard(r.path)) || (await guard(r.from));
          if (why) { out.push({ ...res, result: `skipped: ${why}` }); continue; }
          const has = async p => { try { await fsp.stat(p); return true; } catch { return false; } };
          if (!(await has(r.path))) { out.push({ ...res, result: 'skipped: it is no longer where it was moved to' }); continue; }
          if (await has(r.from)) { out.push({ ...res, result: 'skipped: something new is in its old place' }); continue; }
          await fsp.rename(r.path, r.from);
          await appendDurable(fsp, index(runId), JSON.stringify({ undoId: r.undoId, reverted: true, revertedAt: clock.now() }) + '\n');
          out.push({ ...res, result: 'moved back' }); continue;
        }
        if (!r.afterHash) { out.push({ ...res, result: 'skipped: the change never finished' }); continue; }
        const why = await guard(r.path);
        if (why) { out.push({ ...res, result: `skipped: ${why}` }); continue; }
        let now = null;
        try { now = await fsp.readFile(r.path); } catch (e) { if (e.code !== 'ENOENT') { out.push({ ...res, result: `skipped: ${e.code}` }); continue; } }
        if (!now || sha256(now) !== r.afterHash) { out.push({ ...res, result: 'skipped: the file was changed again afterwards' }); continue; }
        if (r.existed) await writeFileDurable(fsp, r.path, await fsp.readFile(path.join(runDir(runId), r.undoId + '.bak')));
        else await fsp.unlink(r.path);
        await appendDurable(fsp, index(runId), JSON.stringify({ undoId: r.undoId, reverted: true, revertedAt: clock.now() }) + '\n');
        out.push({ ...res, result: r.existed ? 'restored' : 'removed' });
      }
      return out;
    }
  };
}
