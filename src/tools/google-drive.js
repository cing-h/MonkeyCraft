// Google Drive tools for the Clerk: drive.find, drive.read (look only) and
// drive.folder, drive.rename, drive.move, drive.bin (each asks first, every
// time, with a preview; "Revert this job" undoes them).
//
// MonkeyCraft only has the `drive.file` permission, so these see only the
// files MonkeyCraft made (or that the user opened with it). There is no
// sharing tool and no delete: binning is the furthest any tool goes.

import { describe, kindOf, FILE_ID, MIME } from '../google/drive.js';

const NOT_CONNECTED = "Google isn't connected, so nothing was done. Tell the user to open Settings and press Connect Google.";
const MAX_TEXT = 50_000;
const idProp = { type: 'string', maxLength: 200 };
const nameProp = { type: 'string', maxLength: 300 };
const badId = id => !FILE_ID.test(id) && id !== 'root';
const line = f => `- ${describe(f)}  id ${f.id}${f.modifiedTime ? `  changed ${f.modifiedTime.slice(0, 16).replace('T', ' ')}` : ''}${f.webViewLink ? `\n  ${f.webViewLink}` : ''}`;

export function makeDriveTools({ auth, drive, undo }) {
  const connected = () => auth.status().connected;
  /** Look up a file for the preview; a missing one is a plain mistake, not a crash. */
  const lookup = async (id, signal) => {
    if (!connected()) return { error: NOT_CONNECTED };
    if (badId(id)) return { error: `"${id}" isn't a Google file id. Use drive.find to get one. Nothing was done.` };
    try { return { file: await drive.get(id, signal) }; }
    catch (e) { return { error: `${e.message} Nothing was done.` }; }
  };
  const record = async (ctx, label, remote, op) => {
    const s = await undo.saveRemote({ runId: ctx.runId, label: `Google Drive: ${label}`, remote });
    ctx.emit('undo.saved', { undoId: s.undoId, path: `Google Drive: ${label}`, op });
    return s.undoId;
  };

  return [
    {
      name: 'drive.find', capability: 'google', scope: 'read', timeoutMs: 30_000,
      description: "Find files in the user's Google Drive that MonkeyCraft can see (the ones it made, or the user opened with it). Filter by part of the name, kind and folder. Returns ids for the other tools.",
      inputSchema: { type: 'object', properties: { name: nameProp, kind: { type: 'string', enum: ['any', 'doc', 'sheet', 'slides', 'folder'] }, folderId: idProp, limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false },
      assess: async args => !connected() ? { error: NOT_CONNECTED } : (args.folderId && badId(args.folderId)) ? { error: `"${args.folderId}" isn't a folder id. Nothing was done.` } : { summary: `find in Google Drive${args.name ? ` "${args.name}"` : ''}` },
      async run(args, ctx) {
        const files = await drive.find(args, ctx.signal);
        if (!files.length) return { content: 'Nothing found. (MonkeyCraft only sees files it made, or that the user opened with it.)', summary: 'found nothing' };
        return { content: files.map(line).join('\n'), summary: `found ${files.length}` };
      }
    },
    {
      name: 'drive.read', capability: 'google', scope: 'read', timeoutMs: 60_000,
      description: 'Open a Google file and read it: Docs as plain text, Sheets as CSV (first tab), Slides as plain text, folders as a list of what is in them.',
      inputSchema: { type: 'object', properties: { fileId: idProp }, required: ['fileId'], additionalProperties: false },
      async assess(args, ctx) { const l = await lookup(args.fileId, ctx.signal); return l.error ? l : { summary: `read ${describe(l.file)}`, facts: { file: l.file } }; },
      async run(args, ctx, { file }) {
        const head = `${describe(file)}  id ${file.id}${file.webViewLink ? `\n${file.webViewLink}` : ''}${file.trashed ? '\n(It is in the bin.)' : ''}`;
        if (kindOf(file.mimeType) === 'folder') {
          const inside = await drive.find({ folderId: file.id, limit: 100 }, ctx.signal);
          return { content: `${head}\n\nInside:\n${inside.length ? inside.map(line).join('\n') : '(empty)'}`, summary: `opened folder "${file.name}"` };
        }
        const text = await drive.readText(file, ctx.signal);
        if (text === null) return { content: `${head}\n\nThis kind of file can't be read as text.`, summary: 'not readable as text' };
        const body = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + `\n…[cut: ${text.length - MAX_TEXT} more characters]` : text;
        return { content: `${head}\n\n${body}`, summary: `read "${file.name}"` };
      }
    },
    {
      name: 'drive.folder', capability: 'google', scope: 'write', timeoutMs: 30_000,
      description: "Make a new folder in the user's Google Drive (at the top, or inside a folder MonkeyCraft can see). The user is asked first; \"Revert this job\" bins it.",
      inputSchema: { type: 'object', properties: { name: nameProp, parentId: idProp }, required: ['name'], additionalProperties: false },
      async assess(args, ctx) {
        if (!args.name.trim()) return { error: 'The folder needs a name. Nothing was done.' };
        if (!args.parentId) return connected() ? { summary: `make a Google Drive folder "${args.name}" (at the top of My Drive)` } : { error: NOT_CONNECTED };
        const l = await lookup(args.parentId, ctx.signal); if (l.error) return l;
        if (kindOf(l.file.mimeType) !== 'folder') return { error: `${describe(l.file)} isn't a folder. Nothing was done.` };
        return { summary: `make a Google Drive folder "${args.name}"\n  inside ${describe(l.file)}` };
      },
      async run(args, ctx) {
        const undoId = await record(ctx, `new folder "${args.name}"`, { kind: 'create' }, 'write');
        const f = await drive.createFolder(args.name.trim(), args.parentId, ctx.signal);
        await undo.settleRemote(ctx.runId, undoId, { kind: 'create', fileId: f.id });
        return { content: `Made the folder "${f.name}" (id ${f.id}).${f.webViewLink ? ` ${f.webViewLink}` : ''} "Revert this job" would bin it.`, summary: `made folder "${f.name}"` };
      }
    },
    {
      name: 'drive.rename', capability: 'google', scope: 'write', timeoutMs: 30_000,
      description: 'Rename a Google file or folder. The user is asked first; "Revert this job" names it back.',
      inputSchema: { type: 'object', properties: { fileId: idProp, name: nameProp }, required: ['fileId', 'name'], additionalProperties: false },
      async assess(args, ctx) {
        if (!args.name.trim()) return { error: 'The new name is empty. Nothing was done.' };
        const l = await lookup(args.fileId, ctx.signal); if (l.error) return l;
        if (l.file.name === args.name.trim()) return { error: `It's already called "${l.file.name}". Nothing was done.` };
        return { summary: `rename ${describe(l.file)}\n  → "${args.name.trim()}"`, facts: { file: l.file } };
      },
      async run(args, ctx, { file }) {
        const to = args.name.trim();
        const undoId = await record(ctx, `renamed "${file.name}" → "${to}"`, { kind: 'rename', fileId: file.id, from: file.name, to }, 'write');
        await drive.rename(file.id, to, ctx.signal);
        await undo.settleRemote(ctx.runId, undoId);
        return { content: `Renamed ${describe(file)} to "${to}".`, summary: `renamed to "${to}"` };
      }
    },
    {
      name: 'drive.move', capability: 'google', scope: 'write', timeoutMs: 30_000,
      description: 'Move a Google file or folder into another folder ("root" is the top of My Drive). The user is asked first; "Revert this job" moves it back.',
      inputSchema: { type: 'object', properties: { fileId: idProp, folderId: idProp }, required: ['fileId', 'folderId'], additionalProperties: false },
      async assess(args, ctx) {
        const l = await lookup(args.fileId, ctx.signal); if (l.error) return l;
        if (args.folderId === args.fileId) return { error: "A folder can't go inside itself. Nothing was done." };
        let where = 'the top of My Drive';
        if (args.folderId !== 'root') {
          const d = await lookup(args.folderId, ctx.signal); if (d.error) return d;
          if (kindOf(d.file.mimeType) !== 'folder') return { error: `${describe(d.file)} isn't a folder. Nothing was done.` };
          if ((l.file.parents || []).includes(d.file.id)) return { error: `It's already in ${describe(d.file)}. Nothing was done.` };
          where = describe(d.file);
        }
        return { summary: `move ${describe(l.file)}\n  → into ${where}`, facts: { file: l.file } };
      },
      async run(args, ctx, { file }) {
        const remote = { kind: 'move', fileId: file.id, fromParents: file.parents || [] };
        const undoId = await record(ctx, `moved "${file.name}"`, remote, 'move');
        const after = await drive.move(file.id, args.folderId, ctx.signal);
        await undo.settleRemote(ctx.runId, undoId, { ...remote, toParent: (after.parents || [])[0] || args.folderId });
        return { content: `Moved ${describe(file)}. "Revert this job" would move it back.`, summary: `moved "${file.name}"` };
      }
    },
    {
      name: 'drive.bin', capability: 'google', scope: 'write', timeoutMs: 30_000,
      description: "Put a Google file or folder in the Drive bin (the user can restore it there for 30 days). Nothing is ever deleted outright. The user is asked first; \"Revert this job\" takes it back out.",
      inputSchema: { type: 'object', properties: { fileId: idProp }, required: ['fileId'], additionalProperties: false },
      async assess(args, ctx) {
        if (args.fileId === 'root') return { deny: 'the whole of My Drive' };
        const l = await lookup(args.fileId, ctx.signal); if (l.error) return l;
        if (l.file.trashed) return { error: 'It is already in the bin. Nothing was done.' };
        const extra = l.file.mimeType === MIME.folder ? '\n  (and everything inside it)' : '';
        return { summary: `put ${describe(l.file)} in the Google Drive bin${extra}`, facts: { file: l.file } };
      },
      async run(args, ctx, { file }) {
        const undoId = await record(ctx, `binned "${file.name}"`, { kind: 'bin', fileId: file.id }, 'delete');
        await drive.bin(file.id, ctx.signal);
        await undo.settleRemote(ctx.runId, undoId);
        return { content: `Put ${describe(file)} in the bin. It can be restored from the Drive bin for 30 days, or with "Revert this job".`, summary: `binned "${file.name}"` };
      }
    }
  ];
}
