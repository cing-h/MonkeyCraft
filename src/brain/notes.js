// Brain notes: the file format and the rules for where notes may live.
//
// A note is Markdown with YAML frontmatter, readable in Obsidian. Only a small,
// safe subset of YAML is written and read: strings, numbers, booleans, null and
// lists of strings. Unknown keys a person adds in Obsidian are kept as they are.
//
// Pure module: no IO.

import { createHash } from 'node:crypto';

/** Top-level folders the crew may write into. Home.md and Log.md are MonkeyCraft's own. */
export const AREAS = ['You', 'Crew', 'Skills', 'Notes', 'Proposals'];
export const KINDS = ['profile', 'lesson', 'skill', 'note', 'proposal'];
export const SYSTEM_NOTES = ['Home.md', 'Log.md'];
export const META_ORDER = ['title', 'kind', 'ape', 'source_job', 'created', 'updated', 'locked', 'tainted', 'uses', 'last_used'];
// A line ending in this Obsidian comment is locked: nothing but the user may change or remove it.
export const LINE_LOCK = '%%locked%%';

export const sha256 = text => createHash('sha256').update(text).digest('hex');

// ---------- frontmatter ----------

function parseScalar(raw) {
  const v = raw.trim();
  if (v === '' || v === 'null' || v === '~') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith('"')) { try { return JSON.parse(v); } catch { return v; } }
  if (v.startsWith("'") && v.endsWith("'") && v.length > 1) return v.slice(1, -1).replace(/''/g, "'");
  if (v.startsWith('[') && v.endsWith(']')) return v.slice(1, -1).split(',').map(s => parseScalar(s)).filter(s => s !== null).map(String);
  return v;
}

function formatScalar(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return String(v);
  const s = String(v);
  // plain only when YAML can't misread it
  return /^[A-Za-z0-9_][A-Za-z0-9 _./@()+-]*$/.test(s) && !/^(true|false|null|~|-?\d+(\.\d+)?)$/.test(s) && !s.endsWith(' ') ? s : JSON.stringify(s);
}

/** Split a note into { meta, body }. A note without frontmatter has meta {}. Never throws. */
export function parseNote(text) {
  const t = String(text ?? '').replace(/^﻿/, '');
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/);
  if (!m) return { meta: {}, body: t };
  const meta = {}, bare = new Set(); let listKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) { meta[listKey].push(String(parseScalar(item[1]) ?? '')); continue; }
    const kv = line.match(/^([A-Za-z_][\w-]*):(.*)$/);
    if (!kv) { listKey = null; continue; }
    const [, k, rest] = kv;
    if (rest.trim() === '') { meta[k] = []; bare.add(k); listKey = k; continue; }
    meta[k] = parseScalar(rest); listKey = null;
  }
  for (const k of bare) if (meta[k].length === 0) meta[k] = null;   // "key:" with nothing under it
  return { meta, body: t.slice(m[0].length) };
}

/** Build note text from meta and body. Known keys come first, in a fixed order. */
export function formatNote(meta, body) {
  const keys = [...META_ORDER.filter(k => k in meta), ...Object.keys(meta).filter(k => !META_ORDER.includes(k))];
  const lines = keys.filter(k => /^[A-Za-z_][\w-]*$/.test(k)).map(k => {
    const v = meta[k];
    if (Array.isArray(v)) return v.length ? `${k}:\n${v.map(x => `  - ${formatScalar(x)}`).join('\n')}` : `${k}: []`;
    return `${k}: ${formatScalar(v)}`.trimEnd();
  });
  const b = String(body ?? '');
  return `---\n${lines.join('\n')}\n---\n${b.startsWith('\n') ? b.slice(1) : b}${b.endsWith('\n') || !b ? '' : '\n'}`;
}

// ---------- names and places ----------

const BAD_CHARS = /[\\/:*?"<>|#^[\]\u0000-\u001f\u007f]/;

/** A note title usable as an Obsidian file name, or null if it can't be made safe. */
export function safeTitle(title) {
  if (typeof title !== 'string') return null;
  const t = title.replace(/[\\/:*?"<>|#^[\]\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').replace(/[. ]+$/, '');
  return t && t.length <= 120 ? t : null;
}

/** Why a vault-relative path isn't a place notes may live, or null if it's fine. `write` adds the area check. */
export function checkRel(rel, { write = false } = {}) {
  if (typeof rel !== 'string' || !rel) return 'empty path';
  if (rel.length > 400) return 'path too long';
  if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) return 'path must be inside the Brain';
  if (!rel.endsWith('.md')) return 'only Markdown notes (.md) live in the Brain';
  const segs = rel.split('/');
  for (const s of segs) {
    if (!s || s === '.' || s === '..') return 'path has an empty, "." or ".." part';
    if (s.startsWith('.')) return 'hidden folders are MonkeyCraft\'s own';
    if (BAD_CHARS.test(s)) return `"${s}" has a character Obsidian can't use in a name`;
    if (s.length > 124) return 'a name in the path is too long';
  }
  if (segs.length === 1) return SYSTEM_NOTES.includes(rel) ? (write ? `${rel} is kept by MonkeyCraft itself` : null) : 'notes live in one of the Brain\'s folders';
  if (!AREAS.includes(segs[0])) return `"${segs[0]}" isn't one of the Brain's folders (${AREAS.join(', ')})`;
  return null;
}

/** Where a note of this kind belongs. Returns { rel } or { error }. */
export function pathFor({ kind, ape, title, skill }) {
  const t = safeTitle(title), a = ape && safeTitle(ape);
  if (kind === 'skill') { const s = safeTitle(skill || title); return s && a ? { rel: `Skills/${a}/${s}/SKILL.md` } : { error: 'a skill needs an ape and a name' }; }
  if (!t) return { error: 'the title is empty or unusable as a file name' };
  if (kind === 'profile') return { rel: `You/${t}.md` };
  if (kind === 'note') return { rel: `Notes/${t}.md` };
  if (kind === 'proposal') return { rel: `Proposals/${t}.md` };
  if (kind === 'lesson') return a ? { rel: `Crew/${a}/Lessons/${t}.md` } : { error: 'a lesson needs an ape' };
  return { error: `unknown kind "${kind}"` };
}

export const titleOf = rel => rel.split('/').pop().replace(/\.md$/, '');

// ---------- locks ----------

export const isLineLocked = line => line.trimEnd().endsWith(LINE_LOCK);

/** The body's locked lines, in order. */
export const lockedLines = body => String(body ?? '').split('\n').filter(isLineLocked).map(l => l.trimEnd());

/** Lock or unlock body line `index` (0-based). Returns { body } or { error }. */
export function setLineLock(body, index, locked) {
  const lines = String(body ?? '').split('\n');
  if (!Number.isInteger(index) || index < 0 || index >= lines.length) return { error: 'no such line' };
  const raw = lines[index].trimEnd(), on = isLineLocked(raw);
  if (!raw.trim() || (on && raw.trim() === LINE_LOCK)) return { error: 'an empty line can\'t be locked' };
  if (locked && !on) lines[index] = `${raw} ${LINE_LOCK}`;
  if (!locked && on) lines[index] = raw.slice(0, -LINE_LOCK.length).trimEnd();
  return { body: lines.join('\n') };
}

/** Why `next` may not replace `prev` for someone other than the user, or null. */
export function lockViolation(prevText, nextText) {
  const prev = parseNote(prevText), next = parseNote(nextText);
  if (prev.meta.locked === true) return 'this note is locked by the user';
  if (next.meta.locked !== prev.meta.locked && (next.meta.locked ?? false) !== (prev.meta.locked ?? false)) return 'only the user can lock or unlock a note';
  const kept = new Set(lockedLines(next.body));
  for (const l of lockedLines(prev.body)) if (!kept.has(l)) return 'a line the user locked would change or go';
  if (lockedLines(next.body).length > lockedLines(prev.body).length) return 'only the user can lock a line';
  return null;
}
