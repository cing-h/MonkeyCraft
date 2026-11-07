// Google Docs tools for the Clerk:
//   docs.read    the document as Markdown (headings, lists and tables kept)
//   docs.create  a new Google Doc written from Markdown
//   docs.append  add Markdown to the end of a document
//   docs.replace exact find-and-replace, with the expected count checked first
//
// Every change asks first, every time, with a preview. Before the first edit
// of a document this job didn't make, a backup copy goes in the user's Drive,
// because Google's APIs can't restore an old version of a Doc.

import { describe, kindOf, FILE_ID, MIME } from '../google/drive.js';
import { parseMarkdown, countOccurrences } from '../google/docs.js';
import { makeBackups } from '../google/backup.js';

const NOT_CONNECTED = "Google isn't connected, so nothing was done. Tell the user to open Settings and press Connect Google.";
const idProp = { type: 'string', maxLength: 200 };
const mdProp = { type: 'string', maxLength: 200_000 };
const clip = (s, n = 400) => s.length > n ? s.slice(0, n) + '…' : s;
const shape = md => {
  const b = parseMarkdown(md), h = b.filter(x => x.style?.startsWith('HEADING')).length, t = b.filter(x => x.kind === 'table').length;
  return [`${b.length} block${b.length === 1 ? '' : 's'}`, h && `${h} heading${h === 1 ? '' : 's'}`, t && `${t} table${t === 1 ? '' : 's'}`].filter(Boolean).join(', ');
};

export function makeDocsTools({ auth, drive, docs, undo, clock }) {
  const connected = () => auth.status().connected;
  const lookupDoc = async (id, signal) => {
    if (!connected()) return { error: NOT_CONNECTED };
    if (!FILE_ID.test(id)) return { error: `"${id}" isn't a Google file id. Use drive.find to get one. Nothing was done.` };
    let file; try { file = await drive.get(id, signal); } catch (e) { return { error: `${e.message} Nothing was done.` }; }
    if (file.mimeType !== MIME.doc) return { error: `${describe(file)} isn't a Google Doc. Nothing was done.` };
    if (file.trashed) return { error: `${describe(file)} is in the bin. Nothing was done.` };
    return { file };
  };
  const backups = makeBackups({ drive, undo, clock });

  return [
    {
      name: 'docs.read', capability: 'google', scope: 'read', timeoutMs: 60_000,
      description: 'Read a Google Doc as Markdown, with its headings, lists and tables. Use it before changing a document, so edits quote the exact text.',
      inputSchema: { type: 'object', properties: { fileId: idProp }, required: ['fileId'], additionalProperties: false },
      async assess(args, ctx) { const l = await lookupDoc(args.fileId, ctx.signal); return l.error ? l : { summary: `read ${describe(l.file)}`, facts: { file: l.file } }; },
      async run(args, ctx, { file }) {
        const md = docs.docToMarkdown(await docs.get(file.id, ctx.signal));
        return { content: `${describe(file)}  id ${file.id}\n${file.webViewLink || ''}\n\n${md || '(empty)'}`, summary: `read "${file.name}"` };
      }
    },
    {
      name: 'docs.create', capability: 'google', scope: 'write', timeoutMs: 180_000,
      description: 'Make a new Google Doc and write it from Markdown: # headings, - bullets, 1. numbered lists, | tables |, **bold**, *italic*, `code`, [links](https://…). Optionally inside a folder. The user is asked first; "Revert this job" bins it.',
      inputSchema: { type: 'object', properties: { title: { type: 'string', maxLength: 300 }, content: mdProp, folderId: idProp }, required: ['title', 'content'], additionalProperties: false },
      async assess(args, ctx) {
        if (!connected()) return { error: NOT_CONNECTED };
        if (!args.title.trim()) return { error: 'The document needs a title. Nothing was done.' };
        let where = 'at the top of My Drive';
        if (args.folderId) {
          if (!FILE_ID.test(args.folderId)) return { error: `"${args.folderId}" isn't a folder id. Nothing was done.` };
          let f; try { f = await drive.get(args.folderId, ctx.signal); } catch (e) { return { error: `${e.message} Nothing was done.` }; }
          if (kindOf(f.mimeType) !== 'folder') return { error: `${describe(f)} isn't a folder. Nothing was done.` };
          where = `in ${describe(f)}`;
        }
        return { summary: `make a Google Doc "${args.title.trim()}" ${where} (${shape(args.content)})\n\n${clip(args.content)}` };
      },
      async run(args, ctx) {
        const title = args.title.trim();
        const made = await backups.creating(ctx, `new Doc "${title}"`);
        const f = await drive.create({ name: title, kind: 'doc', parentId: args.folderId }, ctx.signal);
        await made(f.id);
        try {
          const r = await docs.appendMarkdown(f.id, args.content, ctx.signal);
          return { content: `Made the Google Doc "${title}" (id ${f.id}) with ${r.paragraphs} paragraph(s) and ${r.tables} table(s).\n${f.webViewLink || ''}\n"Revert this job" would bin it.`, summary: `made Doc "${title}"` };
        } catch (e) {
          return { isError: true, content: `The Doc "${title}" was made (id ${f.id}), but writing into it stopped part-way: ${e.message} Read it with docs.read before adding more.`, summary: 'Doc made, writing stopped' };
        }
      }
    },
    {
      name: 'docs.append', capability: 'google', scope: 'write', timeoutMs: 180_000,
      description: 'Add Markdown to the end of a Google Doc (same Markdown as docs.create). The user is asked first. If this job didn\'t make the document, a backup copy is saved in Drive first.',
      inputSchema: { type: 'object', properties: { fileId: idProp, content: mdProp }, required: ['fileId', 'content'], additionalProperties: false },
      async assess(args, ctx) {
        if (!args.content.trim()) return { error: 'There is nothing to add. Nothing was done.' };
        const l = await lookupDoc(args.fileId, ctx.signal); if (l.error) return l;
        const backup = await backups.note(ctx.runId, l.file.id);
        return { summary: `add to ${describe(l.file)} (${shape(args.content)})${backup}\n\n${clip(args.content)}`, facts: { file: l.file } };
      },
      async run(args, ctx, { file }) {
        const backup = await backups.first(ctx, file);
        const r = await docs.appendMarkdown(file.id, args.content, ctx.signal);
        return { content: `Added ${r.paragraphs} paragraph(s) and ${r.tables} table(s) to "${file.name}".${backup ? ` A backup from before is in Drive: "${backup}".` : ''}`, summary: `added to "${file.name}"` };
      }
    },
    {
      name: 'docs.replace', capability: 'google', scope: 'write', timeoutMs: 60_000,
      description: 'Exact, case-sensitive find-and-replace in a Google Doc. `find` must be text within one paragraph, copied exactly (read the document first). `count` is how many places you expect (default 1); if the document has a different number, nothing changes. The user is asked first. If this job didn\'t make the document, a backup copy is saved in Drive first.',
      inputSchema: { type: 'object', properties: { fileId: idProp, find: { type: 'string', maxLength: 5000 }, replaceWith: { type: 'string', maxLength: 50_000 }, count: { type: 'integer', minimum: 1, maximum: 1000 } }, required: ['fileId', 'find', 'replaceWith'], additionalProperties: false },
      async assess(args, ctx) {
        if (!args.find) return { error: '`find` is empty. Nothing was done.' };
        if (args.find.includes('\n')) return { error: '`find` can\'t cross a line break: replace one paragraph at a time. Nothing was done.' };
        if (args.find === args.replaceWith) return { error: 'The replacement is the same as the text. Nothing was done.' };
        const l = await lookupDoc(args.fileId, ctx.signal); if (l.error) return l;
        const n = countOccurrences(docs.plainText(await docs.get(l.file.id, ctx.signal)), args.find), want = args.count || 1;
        if (n === 0) return { error: `"${clip(args.find, 120)}" isn't in ${describe(l.file)} (the match is exact and case-sensitive). Read it with docs.read and copy the text exactly. Nothing was done.` };
        if (n !== want) return { error: `"${clip(args.find, 120)}" is in ${describe(l.file)} ${n} times, not ${want}. Use a longer, unique piece of text, or set count to ${n} to change them all. Nothing was done.` };
        const backup = await backups.note(ctx.runId, l.file.id);
        return { summary: `in ${describe(l.file)}, replace${n > 1 ? ` (${n} places)` : ''}\n  "${clip(args.find, 300)}"\n  → "${clip(args.replaceWith, 300)}"${backup}`, facts: { file: l.file, n } };
      },
      async run(args, ctx, { file, n }) {
        const backup = await backups.first(ctx, file);
        const changed = await docs.replaceAll(file.id, args.find, args.replaceWith, ctx.signal);
        const note = changed === n ? '' : ` (Google changed ${changed}, not ${n}: the document changed in the meantime)`;
        return { content: `Replaced ${changed} place(s) in "${file.name}"${note}.${backup ? ` A backup from before is in Drive: "${backup}".` : ''}`, summary: `replaced ${changed} in "${file.name}"`, isError: changed === 0 };
      }
    }
  ];
}
