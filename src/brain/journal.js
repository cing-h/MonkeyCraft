// The Brain's change journal: one line per change in .brain/journal.ndjson, and
// a snapshot of each replaced note in .brain/undo/<changeId>.md. Every change can
// be undone from these. The journal entry is written BEFORE the note changes, so a
// crash can leave an entry whose change never landed, but never a change with no
// entry. (Undo checks the note's hash, so such an entry just can't be undone.)
//
// Injected IO only (fsp).

import path from 'node:path';
import { appendDurable, writeFileDurable, parseNdjson } from '../store/durable.js';

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

export function makeBrainJournal({ fsp, dir }) {
  const file = path.join(dir, 'journal.ndjson'), snaps = path.join(dir, 'undo');
  let entries = [];
  const snapFile = id => { if (!SAFE_ID.test(id)) throw new Error(`bad change id: ${id}`); return path.join(snaps, `${id}.md`); };

  return {
    async load() {
      await fsp.mkdir(snaps, { recursive: true });
      try { entries = parseNdjson(await fsp.readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; entries = []; }
    },
    async add(entry) { await appendDurable(fsp, file, JSON.stringify(entry) + '\n'); entries.push(entry); return entry; },
    async saveSnapshot(id, text) { await writeFileDurable(fsp, snapFile(id), text); },
    async readSnapshot(id) { return fsp.readFile(snapFile(id), 'utf8'); },
    get: id => entries.find(e => e.id === id) || null,
    undoneBy: id => entries.find(e => e.op === 'undo' && e.undoes === id) || null,
    /** Newest first, each with `undone` (the id of the change that undid it, or null). */
    list(limit = 50) {
      const undone = new Map(entries.filter(e => e.op === 'undo').map(e => [e.undoes, e.id]));
      return entries.slice(-Math.max(1, Math.min(limit, 500))).reverse().map(e => ({ ...e, undone: undone.get(e.id) || null }));
    },
    count: () => entries.length
  };
}
