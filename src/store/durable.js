// Durable file writes. A crash may lose the newest data, but never leaves a
// half-written file in place of a good one. (StarNet learned this from cron
// jobs double-firing after a crash: rename without fsync isn't durable.)
//
// All IO comes from the injected `fsp` (node:fs/promises or a fake).

import path from 'node:path';

/** Replace `file` atomically: write a temp file, fsync it, rename it, then fsync the directory (best effort). */
export async function writeFileDurable(fsp, file, data, suffix = Math.random().toString(36).slice(2)) {
  const tmp = `${file}.tmp-${suffix}`;
  const fh = await fsp.open(tmp, 'w');
  try { await fh.writeFile(data); await fh.sync(); } finally { await fh.close(); }
  await fsp.rename(tmp, file);
  try { const d = await fsp.open(path.dirname(file), 'r'); try { await d.sync(); } finally { await d.close(); } } catch { /* some filesystems can't fsync a directory */ }
}

/** Append text to `file` and fsync before returning. */
export async function appendDurable(fsp, file, text) {
  const fh = await fsp.open(file, 'a');
  try { await fh.write(text); await fh.sync(); } finally { await fh.close(); }
}

/** Parse NDJSON text and skip lines that don't parse, such as a torn last line after a crash. */
export function parseNdjson(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* torn or corrupt line: skip */ }
  }
  return out;
}
