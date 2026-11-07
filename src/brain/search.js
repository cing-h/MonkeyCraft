// Brain search: a small BM25 index over every note's title, frontmatter and body.
// Kept in memory and updated one note at a time, so a change costs one note's
// work, not a rebuild. Titles count three times, so a note named for the thing
// you asked about comes first.
//
// Pure module: no IO.

const STOP = new Set('a an and are as at be but by for from has have i in is it its of on or that the this to was we were will with you your'.split(' '));
const K1 = 1.2, B = 0.75, TITLE_WEIGHT = 3;

/** Lowercase word tokens (letters and digits in any language), without common little words. */
export function tokenize(text) {
  return (String(text ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[\p{L}\p{N}]+/gu) || [])
    .filter(t => t.length > 1 && !STOP.has(t));
}

export function makeSearch() {
  const docs = new Map();   // rel -> { tf: Map, len, info }
  const df = new Map();     // term -> number of notes holding it
  let totalLen = 0;

  function remove(rel) {
    const d = docs.get(rel); if (!d) return;
    for (const t of d.tf.keys()) { const n = df.get(t) - 1; if (n > 0) df.set(t, n); else df.delete(t); }
    totalLen -= d.len; docs.delete(rel);
  }

  /** Index (or re-index) one note. `info` is returned with hits: { title, kind, ape, ... }. */
  function update(rel, { title, meta = {}, body = '' }, info = {}) {
    remove(rel);
    const tf = new Map(); let len = 0;
    const add = (text, w) => { for (const t of tokenize(text)) { tf.set(t, (tf.get(t) || 0) + w); len += w; } };
    add(title, TITLE_WEIGHT);
    add(Object.entries(meta).filter(([k]) => ['kind', 'ape', 'tags', 'aliases'].includes(k)).map(([, v]) => [].concat(v).join(' ')).join(' '), 1);
    add(body, 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    docs.set(rel, { tf, len, info, body: String(body) });
    totalLen += len;
  }

  function snippet(body, terms) {
    const flat = body.replace(/\s+/g, ' ').trim(), low = flat.toLowerCase();
    let at = -1;
    for (const t of terms) { const i = low.indexOf(t); if (i >= 0 && (at < 0 || i < at)) at = i; }
    const start = Math.max(0, at - 60);
    return (start ? '…' : '') + flat.slice(start, start + 200) + (start + 200 < flat.length ? '…' : '');
  }

  /**
   * Best matches for `q`, highest first: [{ rel, score, snippet, ...info }].
   * `skip(rel)` leaves notes out (for example, the profile for a network agent).
   */
  function query(q, { limit = 10, skip = () => false } = {}) {
    const terms = [...new Set(tokenize(q))];
    if (!terms.length || !docs.size) return [];
    const N = docs.size, avg = totalLen / N, hits = [];
    for (const [rel, d] of docs) {
      if (skip(rel)) continue;
      let score = 0;
      for (const t of terms) {
        const f = d.tf.get(t); if (!f) continue;
        const n = df.get(t), idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += idf * (f * (K1 + 1)) / (f + K1 * (1 - B + B * d.len / avg));
      }
      if (score > 0) hits.push({ rel, score: Math.round(score * 1000) / 1000, snippet: snippet(d.body, terms), ...d.info });
    }
    return hits.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel)).slice(0, Math.max(1, Math.min(limit, 50)));
  }

  return { update, remove, query, has: rel => docs.has(rel), size: () => docs.size, paths: () => [...docs.keys()] };
}
