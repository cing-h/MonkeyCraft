// Google Sheets for the Clerk: tabs, reading and writing cells (formulas
// included, typed as a person would type them), adding rows, and charts.
//
// Cells are addressed the way people write them: a tab name plus A1 cells,
// such as "Budget!B2". Ranges are always computed here from a start cell and
// the size of the rows, so a write can never spill past what was previewed.

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
export const MAX_CELLS = 20_000;

// ---------- A1 helpers ----------
export const colName = n => { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
export const colIndex = s => [...s.toUpperCase()].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;
/** "B3" → { col: 1, row: 2 } (zero-based), or null. */
export function parseCell(a1) {
  const m = /^([A-Za-z]{1,3})([1-9]\d{0,6})$/.exec(String(a1 || '').trim());
  return m ? { col: colIndex(m[1]), row: Number(m[2]) - 1 } : null;
}
/** "A1:C10" → { col, row, endCol, endRow } (zero-based, inclusive), or null. */
export function parseRange(a1) {
  const [a, b] = String(a1 || '').trim().split(':');
  const s = parseCell(a), e = b === undefined ? s : parseCell(b);
  if (!s || !e) return null;
  return { col: Math.min(s.col, e.col), row: Math.min(s.row, e.row), endCol: Math.max(s.col, e.col), endRow: Math.max(s.row, e.row) };
}
export const quoteTab = t => /^[A-Za-z_][A-Za-z0-9_]*$/.test(t) ? t : `'${t.replace(/'/g, "''")}'`;
export const a1 = (tab, r) => `${quoteTab(tab)}!${colName(r.col)}${r.row + 1}${r.endCol === r.col && r.endRow === r.row ? '' : `:${colName(r.endCol)}${r.endRow + 1}`}`;

/** Check rows from a tool call: an array of arrays of strings, numbers, booleans or nulls. Returns { rows, width } or { error }. */
export function checkRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return { error: '`rows` must be a list of rows, each a list of cells.' };
  let width = 0, cells = 0;
  for (const [i, r] of rows.entries()) {
    if (!Array.isArray(r)) return { error: `Row ${i + 1} isn't a list of cells.` };
    for (const c of r) if (!(c === null || ['string', 'number', 'boolean'].includes(typeof c)) || (typeof c === 'string' && c.length > 50_000)) return { error: `Row ${i + 1} has a cell that isn't text, a number, true/false or empty.` };
    width = Math.max(width, r.length); cells += r.length;
  }
  if (!width) return { error: 'Every row is empty.' };
  if (cells > MAX_CELLS) return { error: `That's ${cells} cells; write at most ${MAX_CELLS} at a time.` };
  return { rows: rows.map(r => r.map(c => c === null ? '' : c)), width };
}

/** Rows → a readable table with column letters and row numbers, so cells can be referred to. */
export function gridText(values, start) {
  if (!values?.length) return '(empty)';
  const w = Math.max(...values.map(r => r.length));
  const head = '|   | ' + Array.from({ length: w }, (_, i) => colName(start.col + i)).join(' | ') + ' |';
  const lines = values.map((r, i) => `| ${start.row + i + 1} | ` + Array.from({ length: w }, (_, j) => String(r[j] ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ') + ' |');
  return [head, '|' + ' --- |'.repeat(w + 1), ...lines].join('\n');
}

const CHART = { column: 'COLUMN', bar: 'BAR', line: 'LINE', area: 'AREA', scatter: 'SCATTER' };
export const CHART_TYPES = [...Object.keys(CHART), 'pie'];
const CHART_ROWS = 20;   // a 371 px chart covers about 18 default rows, plus a gap

export function makeSheets({ api }) {
  const url = (id, rest = '') => `${SHEETS}/${encodeURIComponent(id)}${rest}`;
  const batch = (id, requests, signal) => api.call('POST', url(id, ':batchUpdate'), { body: { requests }, signal });

  const sheets = {
    /** The tabs: [{ sheetId, title, rows, cols, charts }]. */
    async tabs(id, signal) {
      const d = await api.call('GET', url(id), { query: { fields: 'sheets(properties(sheetId,title,gridProperties),charts(chartId))' }, signal });
      return (d.sheets || []).map(s => ({ sheetId: s.properties.sheetId, title: s.properties.title, rows: s.properties.gridProperties?.rowCount, cols: s.properties.gridProperties?.columnCount, charts: (s.charts || []).length }));
    },
    async read(id, tab, r, { formulas = false } = {}, signal) {
      const d = await api.call('GET', url(id, `/values/${encodeURIComponent(a1(tab, r))}`), { query: { valueRenderOption: formulas ? 'FORMULA' : 'FORMATTED_VALUE' }, signal });
      return d.values || [];
    },
    /** Write rows starting at a cell. Text starting with = is a formula. */
    async write(id, tab, start, rows, signal) {
      const r = { ...start, endCol: start.col + Math.max(...rows.map(x => x.length)) - 1, endRow: start.row + rows.length - 1 };
      const d = await api.call('PUT', url(id, `/values/${encodeURIComponent(a1(tab, r))}`), { query: { valueInputOption: 'USER_ENTERED' }, body: { values: rows }, signal });
      return { range: a1(tab, r), cells: d.updatedCells ?? null };
    },
    /** Add rows under the last filled row of the tab's table. */
    async append(id, tab, rows, signal) {
      const d = await api.call('POST', url(id, `/values/${encodeURIComponent(`${quoteTab(tab)}!A1`)}:append`), { query: { valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS' }, body: { values: rows }, signal });
      return { range: d.updates?.updatedRange || null };
    },
    async addTab(id, title, signal) {
      const d = await batch(id, [{ addSheet: { properties: { title } } }], signal);
      return d.replies?.[0]?.addSheet?.properties;
    },
    async renameTab(id, sheetId, title, signal) { await batch(id, [{ updateSheetProperties: { properties: { sheetId, title }, fields: 'title' } }], signal); },
    /** Bold and freeze the first row. */
    async header(id, sheetId, signal) {
      await batch(id, [
        { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } },
        { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } }
      ], signal);
    },
    /**
     * A chart from a block of cells: the first column is the labels, the other
     * columns are the series, and the first row holds the names. It goes to the
     * right of the data, below any charts already on the tab (`stack` of them).
     */
    async addChart(id, sheetId, r, type, title, signal, stack = 0) {
      const g = (c0, c1) => ({ sourceRange: { sources: [{ sheetId, startRowIndex: r.row, endRowIndex: r.endRow + 1, startColumnIndex: c0, endColumnIndex: c1 }] } });
      const spec = type === 'pie'
        ? { title, pieChart: { legendPosition: 'RIGHT_LEGEND', domain: g(r.col, r.col + 1), series: g(r.col + 1, r.col + 2) } }
        : { title, basicChart: {
            chartType: CHART[type], legendPosition: 'BOTTOM_LEGEND', headerCount: 1,
            axis: [{ position: 'BOTTOM_AXIS' }, { position: 'LEFT_AXIS' }],
            domains: [{ domain: g(r.col, r.col + 1) }],
            series: Array.from({ length: r.endCol - r.col }, (_, i) => ({ series: g(r.col + 1 + i, r.col + 2 + i), targetAxis: 'LEFT_AXIS' }))
          } };
      const d = await batch(id, [{ addChart: { chart: { spec, position: { overlayPosition: { anchorCell: { sheetId, rowIndex: r.row + stack * CHART_ROWS, columnIndex: r.endCol + 2 }, widthPixels: 600, heightPixels: 371 } } } } }], signal);
      return d.replies?.[0]?.addChart?.chart?.chartId ?? null;
    }
  };
  return sheets;
}
