// Google Slides for the Clerk. A deck is written from a plain outline:
//
//   # Deck title              ← the title slide
//   A subtitle line
//   Notes: what to say on the title slide
//
//   ## A slide title          ← each ## starts a slide
//   - a bullet
//     - an indented bullet    (two spaces per level)
//   A plain line of text
//   Notes: speaker notes      (or lines starting with "> ")
//
// **bold**, *italic*, `code` and [links](https://…) work inside lines.
// The deck can be read back in the same outline format.

import { parseInline } from './docs.js';

const SLIDES = 'https://slides.googleapis.com/v1/presentations';
export const MAX_SLIDES = 100;

// ---------- the outline ----------
/** Outline → { title, subtitle: [line], titleNotes, slides: [{ title, lines: [{ text, spans, bullet, level }], notes }] } or { error }. */
export function parseOutline(md, { requireTitle = true } = {}) {
  const out = { title: null, subtitle: [], titleNotes: [], slides: [] };
  let cur = null, inNotes = false;
  for (const raw of String(md).replace(/\r\n?/g, '\n').split('\n')) {
    const t = raw.trim();
    if (!t) { inNotes = false; continue; }
    let m;
    if ((m = t.match(/^##\s+(.*)$/)) || (!requireTitle && (m = t.match(/^#\s+(.*)$/)))) { cur = { ...parseInline(m[1]), lines: [], notes: [] }; out.slides.push(cur); inNotes = false; continue; }
    if ((m = t.match(/^#\s+(.*)$/))) {
      if (out.title !== null || cur) return { error: 'Only the first line can be the deck title ("# …"); use "## …" for each slide.' };
      out.title = parseInline(m[1]); continue;
    }
    const notes = cur ? cur.notes : out.titleNotes;
    if ((m = t.match(/^notes?:\s*(.*)$/i))) { if (m[1]) notes.push(m[1]); inNotes = true; continue; }
    if ((m = t.match(/^>\s?(.*)$/))) { notes.push(m[1]); inNotes = true; continue; }
    if (inNotes) { notes.push(t); continue; }
    const b = raw.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/);
    const line = b ? { ...parseInline(b[2]), bullet: true, level: Math.min(4, Math.floor(b[1].replace(/\t/g, '  ').length / 2)) } : { ...parseInline(t), bullet: false, level: 0 };
    if (cur) cur.lines.push(line); else out.subtitle.push(line);
  }
  if (requireTitle && out.title === null && !out.slides.length) return { error: 'The outline is empty: start with "# Deck title", then "## …" for each slide.' };
  if (out.slides.length > MAX_SLIDES) return { error: `That's ${out.slides.length} slides; make at most ${MAX_SLIDES} at a time.` };
  out.titleNotes = out.titleNotes.join('\n');
  for (const sl of out.slides) sl.notes = sl.notes.join('\n');
  return out;
}

// ---------- reading a deck ----------
/** A shape's text as [{ text, bullet, level }], one per paragraph. */
function paragraphs(shape) {
  const out = []; let p = null;
  for (const el of shape?.text?.textElements || []) {
    if (el.paragraphMarker) { p = { text: '', bullet: !!el.paragraphMarker.bullet, level: el.paragraphMarker.bullet?.nestingLevel || 0 }; out.push(p); }
    else if (el.textRun) { if (!p) { p = { text: '', bullet: false, level: 0 }; out.push(p); } p.text += el.textRun.content; }
  }
  for (const x of out) x.text = x.text.replace(/\n$/, '');
  return out;
}
const shapes = page => (page?.pageElements || []).filter(e => e.shape);
const kind = e => e.shape.placeholder?.type || '';
const textOf = e => paragraphs(e.shape).map(p => p.text).join('\n');
export function notesShape(slide) {
  const id = slide.slideProperties?.notesPage?.notesProperties?.speakerNotesObjectId;
  return id ? (slide.slideProperties.notesPage.pageElements || []).find(e => e.objectId === id) || { objectId: id } : null;
}
/** Every character on the slides, as the find-and-replace sees it (speaker notes not included). */
export function deckText(pres) { return (pres.slides || []).map(s => shapes(s).map(textOf).join('\n')).join('\n'); }
/** The deck as an outline, with slide numbers. */
export function deckToOutline(pres) {
  const out = [];
  (pres.slides || []).forEach((s, i) => {
    const els = shapes(s);
    const title = els.find(e => ['TITLE', 'CENTERED_TITLE'].includes(kind(e)));
    const rest = els.filter(e => e !== title);
    const isTitleSlide = title && kind(title) === 'CENTERED_TITLE';
    out.push(`${isTitleSlide ? '#' : '##'} ${title ? textOf(title).replace(/\n/g, ' ') : '(no title)'}   [slide ${i + 1}]`);
    for (const e of rest) for (const p of paragraphs(e.shape)) if (p.text) out.push(p.bullet ? `${'  '.repeat(p.level)}- ${p.text}` : p.text);
    const n = notesShape(s); const nt = n?.shape ? textOf(n) : '';
    if (nt.trim()) out.push(`Notes: ${nt.trim().replace(/\n/g, '\n> ')}`);
    out.push('');
  });
  return out.join('\n').trim();
}

// ---------- writing ----------
/** Requests that put lines (bullets, levels, inline styles) into a shape that is empty. */
function textRequests(objectId, lines) {
  if (!lines.length) return [];
  let text = '', offs = [];
  for (const l of lines) { const pre = l.bullet ? '\t'.repeat(l.level) : ''; offs.push(text.length + pre.length); text += pre + l.text + '\n'; }
  text = text.slice(0, -1);
  const reqs = [{ insertText: { objectId, insertionIndex: 0, text } }];
  lines.forEach((l, i) => { for (const sp of l.spans) if (sp.end > sp.start) reqs.push({ updateTextStyle: { objectId, textRange: { type: 'FIXED_RANGE', startIndex: offs[i] + sp.start, endIndex: offs[i] + sp.end }, ...style(sp) } }); });
  // bullets last and newest run first: making bullets removes the leading tabs, which moves later text
  const runs = []; let s = null;
  lines.forEach((l, i) => { if (l.bullet) { if (s === null) s = i; } else if (s !== null) { runs.push([s, i - 1]); s = null; } });
  if (s !== null) runs.push([s, lines.length - 1]);
  const starts = lines.map((l, i) => offs[i] - (l.bullet ? l.level : 0));
  for (const [a, b] of runs.reverse()) reqs.push({ createParagraphBullets: { objectId, textRange: { type: 'FIXED_RANGE', startIndex: starts[a], endIndex: offs[b] + lines[b].text.length }, bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE' } });
  return reqs;
}
const style = sp => sp.bold ? { style: { bold: true }, fields: 'bold' } : sp.italic ? { style: { italic: true }, fields: 'italic' }
  : sp.code ? { style: { fontFamily: 'Roboto Mono' }, fields: 'fontFamily' } : { style: { link: { url: sp.link } }, fields: 'link' };
const asLines = parsed => parsed ? [{ ...parsed, bullet: false, level: 0 }] : [];

export function makeSlides({ api, newObjectId }) {
  const get = (id, signal) => api.call('GET', `${SLIDES}/${encodeURIComponent(id)}`, { signal });
  const batch = (id, requests, signal) => api.call('POST', `${SLIDES}/${encodeURIComponent(id)}:batchUpdate`, { body: { requests }, signal });

  /** Speaker notes for slides that now exist: [{ slideId, notes }]. */
  async function setNotes(id, wanted, signal) {
    const want = wanted.filter(w => w.notes);
    if (!want.length) return;
    const pres = await get(id, signal), reqs = [];
    for (const w of want) {
      const s = pres.slides.find(x => x.objectId === w.slideId), n = s && notesShape(s);
      if (!n) continue;
      if (n.shape && textOf(n)) reqs.push({ deleteText: { objectId: n.objectId, textRange: { type: 'ALL' } } });
      reqs.push({ insertText: { objectId: n.objectId, insertionIndex: 0, text: w.notes } });
    }
    if (reqs.length) await batch(id, reqs, signal);
  }

  /** Add content slides at the end. Returns how many. */
  async function addSlides(id, slides, signal) {
    const reqs = [], notes = [];
    for (const s of slides) {
      const slideId = newObjectId(), titleId = newObjectId(), bodyId = s.lines.length ? newObjectId() : null;
      reqs.push({ createSlide: { objectId: slideId, slideLayoutReference: { predefinedLayout: bodyId ? 'TITLE_AND_BODY' : 'TITLE_ONLY' },
        placeholderIdMappings: [{ layoutPlaceholder: { type: 'TITLE', index: 0 }, objectId: titleId }, ...(bodyId ? [{ layoutPlaceholder: { type: 'BODY', index: 0 }, objectId: bodyId }] : [])] } });
      reqs.push(...textRequests(titleId, asLines(s)));
      if (bodyId) reqs.push(...textRequests(bodyId, s.lines));
      notes.push({ slideId, notes: s.notes });
    }
    if (reqs.length) await batch(id, reqs, signal);
    await setNotes(id, notes, signal);
    return slides.length;
  }

  return {
    get, deckText, deckToOutline,
    /** Fill a new deck: its first (title) slide, then one slide per "##". */
    async writeDeck(id, outline, signal) {
      const pres = await get(id, signal), first = pres.slides?.[0], reqs = [];
      const title = first && shapes(first).find(e => ['CENTERED_TITLE', 'TITLE'].includes(kind(e)));
      const sub = first && shapes(first).find(e => kind(e) === 'SUBTITLE');
      if (title && outline.title) reqs.push(...textRequests(title.objectId, asLines(outline.title)));
      if (sub) reqs.push(...(outline.subtitle.length ? textRequests(sub.objectId, outline.subtitle) : [{ deleteObject: { objectId: sub.objectId } }]));
      if (reqs.length) await batch(id, reqs, signal);
      if (first) await setNotes(id, [{ slideId: first.objectId, notes: outline.titleNotes }], signal);
      return 1 + await addSlides(id, outline.slides, signal);
    },
    addSlides,
    /** Replace one slide's speaker notes (1-based). */
    async setSlideNotes(id, slideId, notes, signal) {
      if (!notes) {
        const pres = await get(id, signal), s = pres.slides.find(x => x.objectId === slideId), n = s && notesShape(s);
        if (n?.shape && textOf(n)) await batch(id, [{ deleteText: { objectId: n.objectId, textRange: { type: 'ALL' } } }], signal);
        return;
      }
      await setNotes(id, [{ slideId, notes }], signal);
    },
    async replaceAll(id, find, replaceWith, signal) {
      const r = await batch(id, [{ replaceAllText: { containsText: { text: find, matchCase: true }, replaceText: replaceWith } }], signal);
      return r?.replies?.[0]?.replaceAllText?.occurrencesChanged || 0;
    }
  };
}
