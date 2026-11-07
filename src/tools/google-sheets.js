// Google Sheets tools for the Clerk:
//   sheets.read    a tab (or a range) as a table with column letters and row numbers
//   sheets.create  a new spreadsheet, optionally filled and with a bold, frozen header row
//   sheets.write   cells from a start cell (formulas typed as text starting with =)
//   sheets.append  rows under the last filled row
//   sheets.tab     a new tab
//   sheets.chart   a chart from a block of cells
//
// Every change asks first, every time, with a preview that says how many filled
// cells would be overwritten. Before the first edit in a job of a spreadsheet
// the job didn't make, a backup copy is saved in Drive.

import { describe, FILE_ID, MIME, kindOf } from '../google/drive.js';
import { parseCell, parseRange, checkRows, gridText, a1, CHART_TYPES, colName } from '../google/sheets.js';
import { makeBackups } from '../google/backup.js';

const NOT_CONNECTED = "Google isn't connected, so nothing was done. Tell the user to open Settings and press Connect Google.";
const idProp = { type: 'string', maxLength: 200 };
const tabProp = { type: 'string', maxLength: 100 };
const rowsProp = { type: 'array' };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const previewRows = rows => gridText(rows.slice(0, 6).map(r => r.map(c => typeof c === 'string' && c.length > 40 ? c.slice(0, 40) + '…' : c)), { col: 0, row: 0 }).split('\n').slice(2).map(l => l.replace(/^\| \d+ \| /, '| ')).join('\n') + (rows.length > 6 ? `\n… and ${plural(rows.length - 6, 'more row')}` : '');

export function makeSheetsTools({ auth, drive, sheets, undo, clock }) {
  const backups = makeBackups({ drive, undo, clock });
  const connected = () => auth.status().connected;
  /** The spreadsheet and the tab to use (the first tab if none is named). */
  async function lookup(args, signal) {
    if (!connected()) return { error: NOT_CONNECTED };
    if (!FILE_ID.test(args.fileId)) return { error: `"${args.fileId}" isn't a Google file id. Use drive.find to get one. Nothing was done.` };
    let file; try { file = await drive.get(args.fileId, signal); } catch (e) { return { error: `${e.message} Nothing was done.` }; }
    if (file.mimeType !== MIME.sheet) return { error: `${describe(file)} isn't a Google Sheet. Nothing was done.` };
    if (file.trashed) return { error: `${describe(file)} is in the bin. Nothing was done.` };
    const tabs = await sheets.tabs(file.id, signal);
    const tab = args.tab === undefined ? tabs[0] : tabs.find(t => t.title === args.tab);
    if (!tab) return { error: `${describe(file)} has no tab called "${args.tab}". Its tabs: ${tabs.map(t => `"${t.title}"`).join(', ')}. Nothing was done.` };
    return { file, tabs, tab };
  }

  return [
    {
      name: 'sheets.read', capability: 'google', scope: 'read', timeoutMs: 60_000,
      description: 'Read a Google Sheet: its tabs, then the cells of one tab (the first if none is named) as a table with column letters and row numbers. Give `range` (like "A1:D20") to read part of it, and `formulas: true` to see formulas instead of their results.',
      inputSchema: { type: 'object', properties: { fileId: idProp, tab: tabProp, range: { type: 'string', maxLength: 30 }, formulas: { type: 'boolean' } }, required: ['fileId'], additionalProperties: false },
      async assess(args, ctx) {
        const l = await lookup(args, ctx.signal); if (l.error) return l;
        const r = args.range ? parseRange(args.range) : null;
        if (args.range && !r) return { error: `"${args.range}" isn't a cell range like A1:D20. Nothing was done.` };
        return { summary: `read ${describe(l.file)}`, facts: { ...l, r } };
      },
      async run(args, ctx, { file, tabs, tab, r }) {
        const range = r || { col: 0, row: 0, endCol: Math.min((tab.cols || 26) - 1, 51), endRow: Math.min((tab.rows || 1000) - 1, 1999) };
        let values = await sheets.read(file.id, tab.title, range, { formulas: !!args.formulas }, ctx.signal);
        let cut = '';
        const cells = values.reduce((n, row) => n + row.length, 0);
        if (cells > 5000) { let n = 0; values = values.filter(row => (n += row.length) <= 5000); cut = `\n…[cut: showing ${values.length} rows; read a smaller range for more]`; }
        const tabList = tabs.map(t => `"${t.title}"${t.charts ? ` (${plural(t.charts, 'chart')})` : ''}`).join(', ');
        return { content: `${describe(file)}  id ${file.id}\n${file.webViewLink || ''}\nTabs: ${tabList}\n\n${a1(tab.title, range)}${args.formulas ? ' (formulas)' : ''}:\n${gridText(values, range)}${cut}`, summary: `read "${file.name}"` };
      }
    },
    {
      name: 'sheets.create', capability: 'google', scope: 'write', timeoutMs: 120_000,
      description: 'Make a new Google Sheet. Optionally fill it from `rows` (a list of rows, each a list of cells; text starting with = is a formula, like "=SUM(B2:B9)"), name its first tab, and put it in a folder. With `header` (on by default when there are rows), the first row is bold and stays in view. The user is asked first; "Revert this job" bins it.',
      inputSchema: { type: 'object', properties: { title: { type: 'string', maxLength: 300 }, rows: rowsProp, tab: tabProp, header: { type: 'boolean' }, folderId: idProp }, required: ['title'], additionalProperties: false },
      async assess(args, ctx) {
        if (!connected()) return { error: NOT_CONNECTED };
        if (!args.title.trim()) return { error: 'The spreadsheet needs a title. Nothing was done.' };
        if (args.tab !== undefined && !args.tab.trim()) return { error: 'The tab name is empty. Nothing was done.' };
        const c = args.rows === undefined ? null : checkRows(args.rows);
        if (c?.error) return { error: `${c.error} Nothing was done.` };
        let where = 'at the top of My Drive';
        if (args.folderId) {
          if (!FILE_ID.test(args.folderId)) return { error: `"${args.folderId}" isn't a folder id. Nothing was done.` };
          let f; try { f = await drive.get(args.folderId, ctx.signal); } catch (e) { return { error: `${e.message} Nothing was done.` }; }
          if (kindOf(f.mimeType) !== 'folder') return { error: `${describe(f)} isn't a folder. Nothing was done.` };
          where = `in ${describe(f)}`;
        }
        const size = c ? ` with ${plural(c.rows.length, 'row')} × ${plural(c.width, 'column')}` : ' (empty)';
        return { summary: `make a Google Sheet "${args.title.trim()}" ${where}${size}${c ? `\n\n${previewRows(c.rows)}` : ''}`, facts: { rows: c?.rows } };
      },
      async run(args, ctx, { rows }) {
        const title = args.title.trim();
        const made = await backups.creating(ctx, `new Sheet "${title}"`);
        const f = await drive.create({ name: title, kind: 'sheet', parentId: args.folderId }, ctx.signal);
        await made(f.id);
        try {
          const [first] = await sheets.tabs(f.id, ctx.signal);
          let tab = first.title;
          if (args.tab && args.tab.trim() !== tab) { await sheets.renameTab(f.id, first.sheetId, args.tab.trim(), ctx.signal); tab = args.tab.trim(); }
          if (rows) {
            await sheets.write(f.id, tab, { col: 0, row: 0 }, rows, ctx.signal);
            if (args.header ?? rows.length > 1) await sheets.header(f.id, first.sheetId, ctx.signal);
          }
          return { content: `Made the Google Sheet "${title}" (id ${f.id})${rows ? ` and filled ${plural(rows.length, 'row')} on the tab "${tab}"` : ''}.\n${f.webViewLink || ''}\n"Revert this job" would bin it.`, summary: `made Sheet "${title}"` };
        } catch (e) {
          return { isError: true, content: `The Sheet "${title}" was made (id ${f.id}), but filling it stopped part-way: ${e.message} Read it with sheets.read before adding more.`, summary: 'Sheet made, filling stopped' };
        }
      }
    },
    {
      name: 'sheets.write', capability: 'google', scope: 'write', timeoutMs: 120_000,
      description: 'Write cells into a Google Sheet, starting at `start` (like "B2") on a tab (the first if none is named). `rows` is a list of rows, each a list of cells; text starting with = is a formula. Cells are entered as if typed. The preview says how many filled cells would be overwritten. The user is asked first; a backup copy is saved first if this job didn\'t make the spreadsheet.',
      inputSchema: { type: 'object', properties: { fileId: idProp, tab: tabProp, start: { type: 'string', maxLength: 10 }, rows: rowsProp }, required: ['fileId', 'start', 'rows'], additionalProperties: false },
      async assess(args, ctx) {
        const start = parseCell(args.start);
        if (!start) return { error: `"${args.start}" isn't a cell like A1 or B2. Nothing was done.` };
        const c = checkRows(args.rows); if (c.error) return { error: `${c.error} Nothing was done.` };
        const l = await lookup(args, ctx.signal); if (l.error) return l;
        const r = { ...start, endCol: start.col + c.width - 1, endRow: start.row + c.rows.length - 1 };
        const old = await sheets.read(l.file.id, l.tab.title, r, {}, ctx.signal);
        const filled = old.reduce((n, row) => n + row.filter(v => v !== '' && v !== null && v !== undefined).length, 0);
        const over = filled ? `\n  ⚠ overwrites ${plural(filled, 'filled cell')}` : '\n  (all those cells are empty now)';
        return { summary: `write ${plural(c.rows.length, 'row')} × ${plural(c.width, 'column')} into ${describe(l.file)} at ${a1(l.tab.title, r)}${over}${await backups.note(ctx.runId, l.file.id)}\n\n${previewRows(c.rows)}`, facts: { ...l, start, rows: c.rows } };
      },
      async run(args, ctx, { file, tab, start, rows }) {
        const backup = await backups.first(ctx, file);
        const w = await sheets.write(file.id, tab.title, start, rows, ctx.signal);
        return { content: `Wrote ${w.range} in "${file.name}".${backup ? ` A backup from before is in Drive: "${backup}".` : ''} Read it back with sheets.read to check formulas.`, summary: `wrote ${w.range}` };
      }
    },
    {
      name: 'sheets.append', capability: 'google', scope: 'write', timeoutMs: 120_000,
      description: 'Add rows under the last filled row of a tab in a Google Sheet (the first tab if none is named). Nothing is overwritten. The user is asked first; a backup copy is saved first if this job didn\'t make the spreadsheet.',
      inputSchema: { type: 'object', properties: { fileId: idProp, tab: tabProp, rows: rowsProp }, required: ['fileId', 'rows'], additionalProperties: false },
      async assess(args, ctx) {
        const c = checkRows(args.rows); if (c.error) return { error: `${c.error} Nothing was done.` };
        const l = await lookup(args, ctx.signal); if (l.error) return l;
        return { summary: `add ${plural(c.rows.length, 'row')} to the end of tab "${l.tab.title}" in ${describe(l.file)}${await backups.note(ctx.runId, l.file.id)}\n\n${previewRows(c.rows)}`, facts: { ...l, rows: c.rows } };
      },
      async run(args, ctx, { file, tab, rows }) {
        const backup = await backups.first(ctx, file);
        const a = await sheets.append(file.id, tab.title, rows, ctx.signal);
        return { content: `Added ${plural(rows.length, 'row')} to "${file.name}"${a.range ? ` at ${a.range}` : ''}.${backup ? ` A backup from before is in Drive: "${backup}".` : ''}`, summary: `added ${plural(rows.length, 'row')}` };
      }
    },
    {
      name: 'sheets.tab', capability: 'google', scope: 'write', timeoutMs: 60_000,
      description: 'Add a new, empty tab to a Google Sheet. The user is asked first; a backup copy is saved first if this job didn\'t make the spreadsheet.',
      inputSchema: { type: 'object', properties: { fileId: idProp, name: tabProp }, required: ['fileId', 'name'], additionalProperties: false },
      async assess(args, ctx) {
        const name = args.name.trim();
        if (!name) return { error: 'The tab needs a name. Nothing was done.' };
        const l = await lookup({ fileId: args.fileId }, ctx.signal); if (l.error) return l;
        if (l.tabs.some(t => t.title.toLowerCase() === name.toLowerCase())) return { error: `${describe(l.file)} already has a tab called "${name}". Nothing was done.` };
        return { summary: `add a tab "${name}" to ${describe(l.file)}${await backups.note(ctx.runId, l.file.id)}`, facts: { file: l.file, name } };
      },
      async run(args, ctx, { file, name }) {
        const backup = await backups.first(ctx, file);
        await sheets.addTab(file.id, name, ctx.signal);
        return { content: `Added the tab "${name}" to "${file.name}".${backup ? ` A backup from before is in Drive: "${backup}".` : ''}`, summary: `added tab "${name}"` };
      }
    },
    {
      name: 'sheets.chart', capability: 'google', scope: 'write', timeoutMs: 60_000,
      description: `Add a chart to a Google Sheet from a block of cells (\`range\`, like "A1:C8"): the first column is the labels, each other column is one series, and the first row holds their names. Types: ${CHART_TYPES.join(', ')} (pie uses only the second column). It is placed to the right of the data. The user is asked first; a backup copy is saved first if this job didn't make the spreadsheet.`,
      inputSchema: { type: 'object', properties: { fileId: idProp, tab: tabProp, range: { type: 'string', maxLength: 30 }, type: { type: 'string', enum: CHART_TYPES }, title: { type: 'string', maxLength: 200 } }, required: ['fileId', 'range', 'type'], additionalProperties: false },
      async assess(args, ctx) {
        const r = parseRange(args.range);
        if (!r) return { error: `"${args.range}" isn't a cell range like A1:C8. Nothing was done.` };
        if (r.endCol === r.col || r.endRow - r.row < 2) return { error: 'A chart needs at least two columns (labels and numbers) and a header row plus two rows of data. Nothing was done.' };
        const l = await lookup(args, ctx.signal); if (l.error) return l;
        const series = `${args.type === 'pie' ? 1 : r.endCol - r.col} series`;
        return { summary: `add a ${args.type} chart${args.title ? ` "${args.title}"` : ''} to ${describe(l.file)}\n  from ${a1(l.tab.title, r)} (labels in column ${colName(r.col)}, ${series}), placed at column ${colName(r.endCol + 2)}${l.tab.charts ? `, below the ${plural(l.tab.charts, 'chart')} already there` : ''}${await backups.note(ctx.runId, l.file.id)}`, facts: { ...l, r } };
      },
      async run(args, ctx, { file, tab, r }) {
        const backup = await backups.first(ctx, file);
        await sheets.addChart(file.id, tab.sheetId, r, args.type, args.title || '', ctx.signal, tab.charts || 0);
        return { content: `Added a ${args.type} chart to "${file.name}" (tab "${tab.title}").${backup ? ` A backup from before is in Drive: "${backup}".` : ''}`, summary: `added ${args.type} chart` };
      }
    }
  ];
}
