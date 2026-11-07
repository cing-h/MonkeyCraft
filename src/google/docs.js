// Google Docs for the Clerk. The Clerk writes simple Markdown and this module
// turns it into real Docs formatting:
//   # to ###### headings, - bullets, 1. numbered lists, | tables |,
//   **bold**, *italic*, `code` and [links](https://…).
// It also reads a Doc back as the same Markdown, and does exact find-and-replace.
//
// Indices are never guessed: before each piece is added, the document is read
// back and the piece goes at its real end.

const DOCS = 'https://docs.googleapis.com/v1/documents';

// ---------- Markdown → blocks ----------
/** Inline Markdown → { text, spans: [{ start, end, bold?|italic?|code?|link? }] }. */
export function parseInline(src) {
  let text = ''; const spans = [];
  const re = /\*\*(.+?)\*\*|(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)|(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0, m;
  while ((m = re.exec(src))) {
    text += src.slice(last, m.index);
    const start = text.length;
    if (m[1] !== undefined) { const inner = parseInline(m[1]); text += inner.text; spans.push({ start, end: text.length, bold: true }, ...inner.spans.map(s => ({ ...s, start: s.start + start, end: s.end + start }))); }
    else if (m[2] !== undefined || m[3] !== undefined) { text += m[2] ?? m[3]; spans.push({ start, end: text.length, italic: true }); }
    else if (m[4] !== undefined) { text += m[4]; spans.push({ start, end: text.length, code: true }); }
    else { text += m[5]; spans.push({ start, end: text.length, link: m[6] }); }
    last = re.lastIndex;
  }
  text += src.slice(last);
  return { text, spans };
}

/** Markdown → [{ kind: 'para', style, list?, text, spans } | { kind: 'table', rows: [[{text, spans}]] }]. */
export function parseMarkdown(md) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const blocks = []; let para = null;
  const flush = () => { if (para) { blocks.push({ kind: 'para', style: 'NORMAL_TEXT', ...parseInline(para.join(' ')) }); para = null; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], t = line.trim();
    if (!t) { flush(); continue; }
    let m;
    if ((m = t.match(/^(#{1,6})\s+(.*)$/))) { flush(); blocks.push({ kind: 'para', style: `HEADING_${m[1].length}`, ...parseInline(m[2].replace(/\s+#+\s*$/, '')) }); continue; }
    if ((m = t.match(/^[-*+]\s+(.*)$/))) { flush(); blocks.push({ kind: 'para', style: 'NORMAL_TEXT', list: 'bullet', ...parseInline(m[1]) }); continue; }
    if ((m = t.match(/^\d+[.)]\s+(.*)$/))) { flush(); blocks.push({ kind: 'para', style: 'NORMAL_TEXT', list: 'number', ...parseInline(m[1]) }); continue; }
    if (t.startsWith('|')) {
      flush();
      const rows = [];
      for (; i < lines.length && lines[i].trim().startsWith('|'); i++) {
        const r = lines[i].trim();
        if (/^\|?[\s:|-]+\|?$/.test(r) && r.includes('-')) continue;   // the |---|---| line
        rows.push(r.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => parseInline(c.trim())));
      }
      i--;
      const cols = Math.max(...rows.map(r => r.length));
      if (rows.length) blocks.push({ kind: 'table', rows: rows.map(r => [...r, ...Array(cols - r.length).fill({ text: '', spans: [] })]) });
      continue;
    }
    (para ||= []).push(t);
  }
  flush();
  return blocks;
}

// ---------- reading a Doc ----------
const runsText = els => (els || []).map(e => e.textRun?.content || '').join('');
/** Every character of the document, as the find-and-replace sees it. */
export function plainText(doc) {
  const walk = content => (content || []).map(el => el.paragraph ? runsText(el.paragraph.elements)
    : el.table ? el.table.tableRows.map(r => r.tableCells.map(c => walk(c.content)).join('')).join('') : '').join('');
  return walk(doc.body?.content);
}
/** The document as Markdown, the same flavour the Clerk writes. */
export function docToMarkdown(doc) {
  const out = [];
  const listKind = id => { const g = doc.lists?.[id]?.listProperties?.nestingLevels?.[0]; return g?.glyphType && g.glyphType !== 'GLYPH_TYPE_UNSPECIFIED' ? 'number' : 'bullet'; };
  for (const el of doc.body?.content || []) {
    if (el.paragraph) {
      const p = el.paragraph, text = runsText(p.elements).replace(/\n$/, '');
      const h = (p.paragraphStyle?.namedStyleType || '').match(/^HEADING_(\d)$/);
      if (p.bullet) out.push(`${listKind(p.bullet.listId) === 'number' ? '1.' : '-'} ${text}`);
      else if (h) out.push('', `${'#'.repeat(Number(h[1]))} ${text}`);
      else if (p.paragraphStyle?.namedStyleType === 'TITLE') out.push('', `# ${text}`);
      else out.push(text);
    } else if (el.table) {
      const rows = el.table.tableRows.map(r => '| ' + r.tableCells.map(c => (c.content || []).map(x => runsText(x.paragraph?.elements).replace(/\n$/, '')).join(' ').replace(/\|/g, '\\|')).join(' | ') + ' |');
      out.push('', rows[0], '|' + ' --- |'.repeat(el.table.columns || 1), ...rows.slice(1), '');
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const bodyEnd = doc => { const c = doc.body?.content || []; return c.length ? c[c.length - 1].endIndex : 2; };
const lastPara = doc => { const c = doc.body?.content || []; const l = c[c.length - 1]; return l?.paragraph ? runsText(l.paragraph.elements).replace(/\n$/, '') : ''; };
const textStyle = s => {
  if (s.bold) return [{ bold: true }, 'bold'];
  if (s.italic) return [{ italic: true }, 'italic'];
  if (s.code) return [{ weightedFontFamily: { fontFamily: 'Roboto Mono' } }, 'weightedFontFamily'];
  return [{ link: { url: s.link } }, 'link'];
};

export function makeDocs({ api }) {
  const get = (id, signal) => api.call('GET', `${DOCS}/${encodeURIComponent(id)}`, { signal });
  const batch = (id, requests, signal) => api.call('POST', `${DOCS}/${encodeURIComponent(id)}:batchUpdate`, { body: { requests }, signal });

  /** Requests that add paragraphs at `index` (prefixing a line break if the last paragraph has text). */
  function paraRequests(paras, index, needsBreak) {
    const T = paras.map(p => p.text).join('\n');
    const base = index + (needsBreak ? 1 : 0), end = base + T.length + 1;
    const reqs = [{ insertText: { location: { index }, text: (needsBreak ? '\n' : '') + T } }];
    // what's inserted inherits the style around it, so set everything explicitly
    reqs.push({ updateTextStyle: { range: { startIndex: base, endIndex: end - 1 || base }, textStyle: {}, fields: 'bold,italic,link,weightedFontFamily' } });
    reqs.push({ deleteParagraphBullets: { range: { startIndex: base, endIndex: end - 1 || base } } });
    let off = base; const runs = [];
    for (const p of paras) {
      const s = off, e = off + p.text.length + 1;
      reqs.push({ updateParagraphStyle: { range: { startIndex: s, endIndex: e }, paragraphStyle: { namedStyleType: p.style }, fields: 'namedStyleType' } });
      const prev = runs[runs.length - 1];
      if (p.list) { if (prev && prev.list === p.list && prev.end === s) prev.end = e; else runs.push({ list: p.list, start: s, end: e }); }
      for (const sp of p.spans) if (sp.end > sp.start) { const [ts, f] = textStyle(sp); reqs.push({ updateTextStyle: { range: { startIndex: s + sp.start, endIndex: s + sp.end }, textStyle: ts, fields: f } }); }
      off = e;
    }
    for (const r of runs) reqs.push({ createParagraphBullets: { range: { startIndex: r.start, endIndex: r.end - 1 }, bulletPreset: r.list === 'number' ? 'NUMBERED_DECIMAL_ALPHA_ROMAN' : 'BULLET_DISC_CIRCLE_SQUARE' } });
    return reqs.filter(r => !(r.updateTextStyle && r.updateTextStyle.range.endIndex <= r.updateTextStyle.range.startIndex) && !(r.deleteParagraphBullets && r.deleteParagraphBullets.range.endIndex <= r.deleteParagraphBullets.range.startIndex));
  }

  async function addTable(id, rows, signal) {
    // a table takes the indent of the paragraph it follows, so first end on a plain, empty, un-listed line
    const before = await get(id, signal), c = before.body?.content || [], last = c[c.length - 1];
    const reqs0 = [];
    let start = last?.startIndex ?? 1;
    if (lastPara(before) !== '' || !last?.paragraph) { reqs0.push({ insertText: { location: { index: bodyEnd(before) - 1 }, text: '\n' } }); start = bodyEnd(before); }
    reqs0.push({ deleteParagraphBullets: { range: { startIndex: start, endIndex: start + 1 } } });
    reqs0.push({ updateParagraphStyle: { range: { startIndex: start, endIndex: start + 1 }, paragraphStyle: { namedStyleType: 'NORMAL_TEXT' }, fields: 'namedStyleType' } });
    reqs0.push({ insertTable: { rows: rows.length, columns: rows[0].length, endOfSegmentLocation: { segmentId: '' } } });
    await batch(id, reqs0, signal);
    const doc = await get(id, signal);
    const table = [...(doc.body?.content || [])].reverse().find(e => e.table);
    if (!table) throw new Error('Google made the table but it could not be found afterwards');
    const cells = [];
    table.table.tableRows.forEach((r, ri) => r.tableCells.forEach((c, ci) => cells.push({ at: c.content[0].startIndex, cell: rows[ri]?.[ci], header: ri === 0 && rows.length > 1 })));
    const reqs = [];
    for (const { at, cell, header } of cells.sort((a, b) => b.at - a.at)) {   // last cell first, so earlier positions don't move
      if (!cell?.text) continue;
      reqs.push({ insertText: { location: { index: at }, text: cell.text } });
      if (header) reqs.push({ updateTextStyle: { range: { startIndex: at, endIndex: at + cell.text.length }, textStyle: { bold: true }, fields: 'bold' } });
      for (const sp of cell.spans) if (sp.end > sp.start) { const [ts, f] = textStyle(sp); reqs.push({ updateTextStyle: { range: { startIndex: at + sp.start, endIndex: at + sp.end }, textStyle: ts, fields: f } }); }
    }
    if (reqs.length) await batch(id, reqs, signal);
  }

  const docs = {
    get, plainText, docToMarkdown,
    /** Add Markdown at the end of the document. Returns { paragraphs, tables }. */
    async appendMarkdown(id, md, signal) {
      const blocks = parseMarkdown(md);
      let paragraphs = 0, tables = 0;
      for (let i = 0; i < blocks.length;) {
        if (blocks[i].kind === 'table') { await addTable(id, blocks[i].rows, signal); tables++; i++; continue; }
        const run = []; while (i < blocks.length && blocks[i].kind === 'para') run.push(blocks[i++]);
        const doc = await get(id, signal);
        const at = bodyEnd(doc) - 1;
        await batch(id, paraRequests(run, at, lastPara(doc) !== ''), signal);
        paragraphs += run.length;
      }
      return { paragraphs, tables };
    },
    /** Exact, case-sensitive find-and-replace everywhere in the document. Returns how many were changed. */
    async replaceAll(id, find, replaceWith, signal) {
      const r = await batch(id, [{ replaceAllText: { containsText: { text: find, matchCase: true }, replaceText: replaceWith } }], signal);
      return r?.replies?.[0]?.replaceAllText?.occurrencesChanged || 0;
    }
  };
  return docs;
}

/** How many times `find` appears in `text` (non-overlapping, like Docs counts it). */
export function countOccurrences(text, find) {
  if (!find) return 0;
  let n = 0, i = 0;
  while ((i = text.indexOf(find, i)) !== -1) { n++; i += find.length; }
  return n;
}
