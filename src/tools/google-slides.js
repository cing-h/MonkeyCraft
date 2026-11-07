// Google Slides tools for the Clerk:
//   slides.read    the deck as an outline, with slide numbers and speaker notes
//   slides.create  a new deck from an outline (title slide, one slide per "##", notes)
//   slides.add     more slides at the end
//   slides.notes   replace one slide's speaker notes
//   slides.replace exact find-and-replace on the slides, with the expected count checked first
//
// Every change asks first, every time, with a preview. Before the first edit in
// a job of a deck the job didn't make, a backup copy is saved in Drive.

import { describe, FILE_ID, MIME, kindOf } from '../google/drive.js';
import { parseOutline } from '../google/slides.js';
import { countOccurrences } from '../google/docs.js';
import { makeBackups } from '../google/backup.js';

const NOT_CONNECTED = "Google isn't connected, so nothing was done. Tell the user to open Settings and press Connect Google.";
const idProp = { type: 'string', maxLength: 200 };
const outlineProp = { type: 'string', maxLength: 100_000 };
const clip = (s, n = 400) => s.length > n ? s.slice(0, n) + '…' : s;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const OUTLINE_HELP = 'Outline format: "# Deck title" first (then optional subtitle lines), then "## Slide title" for each slide, "- bullet" lines (two spaces more per indent level), plain lines, and "Notes: …" (or "> …" lines) for speaker notes. **bold**, *italic*, `code` and [links](https://…) work.';
const titles = o => o.slides.map((s, i) => `  ${i + 1}. ${s.text}${s.notes ? '  (with notes)' : ''}`).slice(0, 12).join('\n') + (o.slides.length > 12 ? `\n  … and ${plural(o.slides.length - 12, 'more slide')}` : '');

export function makeSlidesTools({ auth, drive, slides, undo, clock }) {
  const backups = makeBackups({ drive, undo, clock });
  const connected = () => auth.status().connected;
  async function lookup(id, signal) {
    if (!connected()) return { error: NOT_CONNECTED };
    if (!FILE_ID.test(id)) return { error: `"${id}" isn't a Google file id. Use drive.find to get one. Nothing was done.` };
    let file; try { file = await drive.get(id, signal); } catch (e) { return { error: `${e.message} Nothing was done.` }; }
    if (file.mimeType !== MIME.slides) return { error: `${describe(file)} isn't a Google Slides deck. Nothing was done.` };
    if (file.trashed) return { error: `${describe(file)} is in the bin. Nothing was done.` };
    return { file };
  }

  return [
    {
      name: 'slides.read', capability: 'google', scope: 'read', timeoutMs: 60_000,
      description: 'Read a Google Slides deck as an outline: each slide\'s number, title, text and speaker notes.',
      inputSchema: { type: 'object', properties: { fileId: idProp }, required: ['fileId'], additionalProperties: false },
      async assess(args, ctx) { const l = await lookup(args.fileId, ctx.signal); return l.error ? l : { summary: `read ${describe(l.file)}`, facts: l }; },
      async run(args, ctx, { file }) {
        const pres = await slides.get(file.id, ctx.signal);
        return { content: `${describe(file)}  id ${file.id}  (${plural(pres.slides?.length || 0, 'slide')})\n${file.webViewLink || ''}\n\n${slides.deckToOutline(pres) || '(empty)'}`, summary: `read "${file.name}"` };
      }
    },
    {
      name: 'slides.create', capability: 'google', scope: 'write', timeoutMs: 180_000,
      description: `Make a new Google Slides deck from an outline, optionally inside a folder. ${OUTLINE_HELP} The user is asked first; "Revert this job" bins it.`,
      inputSchema: { type: 'object', properties: { outline: outlineProp, folderId: idProp }, required: ['outline'], additionalProperties: false },
      async assess(args, ctx) {
        if (!connected()) return { error: NOT_CONNECTED };
        const o = parseOutline(args.outline);
        if (o.error) return { error: `${o.error} Nothing was done.` };
        if (!o.title?.text.trim()) return { error: 'The outline needs a deck title on its first line ("# …"). Nothing was done.' };
        let where = 'at the top of My Drive';
        if (args.folderId) {
          if (!FILE_ID.test(args.folderId)) return { error: `"${args.folderId}" isn't a folder id. Nothing was done.` };
          let f; try { f = await drive.get(args.folderId, ctx.signal); } catch (e) { return { error: `${e.message} Nothing was done.` }; }
          if (kindOf(f.mimeType) !== 'folder') return { error: `${describe(f)} isn't a folder. Nothing was done.` };
          where = `in ${describe(f)}`;
        }
        return { summary: `make a Google Slides deck "${o.title.text}" ${where}: a title slide and ${plural(o.slides.length, 'slide')}${o.slides.length ? `\n${titles(o)}` : ''}`, facts: { o } };
      },
      async run(args, ctx, { o }) {
        const name = o.title.text.trim();
        const made = await backups.creating(ctx, `new deck "${name}"`);
        const f = await drive.create({ name, kind: 'slides', parentId: args.folderId }, ctx.signal);
        await made(f.id);
        try {
          const n = await slides.writeDeck(f.id, o, ctx.signal);
          return { content: `Made the Google Slides deck "${name}" (id ${f.id}) with ${plural(n, 'slide')}.\n${f.webViewLink || ''}\n"Revert this job" would bin it.`, summary: `made deck "${name}"` };
        } catch (e) {
          return { isError: true, content: `The deck "${name}" was made (id ${f.id}), but filling it stopped part-way: ${e.message} Read it with slides.read before adding more.`, summary: 'deck made, filling stopped' };
        }
      }
    },
    {
      name: 'slides.add', capability: 'google', scope: 'write', timeoutMs: 180_000,
      description: `Add slides to the end of a Google Slides deck. Each "## Slide title" (or "# …") starts a slide; the rest is as in slides.create. ${OUTLINE_HELP} The user is asked first; a backup copy is saved first if this job didn't make the deck.`,
      inputSchema: { type: 'object', properties: { fileId: idProp, outline: outlineProp }, required: ['fileId', 'outline'], additionalProperties: false },
      async assess(args, ctx) {
        const o = parseOutline(args.outline, { requireTitle: false });
        if (o.error) return { error: `${o.error} Nothing was done.` };
        if (!o.slides.length) return { error: 'There are no slides in that outline: start each one with "## Slide title". Nothing was done.' };
        const l = await lookup(args.fileId, ctx.signal); if (l.error) return l;
        return { summary: `add ${plural(o.slides.length, 'slide')} to the end of ${describe(l.file)}${await backups.note(ctx.runId, l.file.id)}\n${titles(o)}`, facts: { ...l, o } };
      },
      async run(args, ctx, { file, o }) {
        const backup = await backups.first(ctx, file);
        const n = await slides.addSlides(file.id, o.slides, ctx.signal);
        return { content: `Added ${plural(n, 'slide')} to "${file.name}".${backup ? ` A backup from before is in Drive: "${backup}".` : ''}`, summary: `added ${plural(n, 'slide')}` };
      }
    },
    {
      name: 'slides.notes', capability: 'google', scope: 'write', timeoutMs: 60_000,
      description: 'Replace the speaker notes of one slide (numbered from 1, as slides.read shows). Empty notes clear them. The user is asked first; a backup copy is saved first if this job didn\'t make the deck.',
      inputSchema: { type: 'object', properties: { fileId: idProp, slide: { type: 'integer', minimum: 1, maximum: 1000 }, notes: { type: 'string', maxLength: 20_000 } }, required: ['fileId', 'slide', 'notes'], additionalProperties: false },
      async assess(args, ctx) {
        const l = await lookup(args.fileId, ctx.signal); if (l.error) return l;
        const pres = await slides.get(l.file.id, ctx.signal), s = pres.slides?.[args.slide - 1];
        if (!s) return { error: `${describe(l.file)} has ${plural(pres.slides?.length || 0, 'slide')}, so there is no slide ${args.slide}. Nothing was done.` };
        return { summary: `${args.notes ? 'set' : 'clear'} the speaker notes of slide ${args.slide} in ${describe(l.file)}${await backups.note(ctx.runId, l.file.id)}${args.notes ? `\n\n${clip(args.notes)}` : ''}`, facts: { ...l, slideId: s.objectId } };
      },
      async run(args, ctx, { file, slideId }) {
        const backup = await backups.first(ctx, file);
        await slides.setSlideNotes(file.id, slideId, args.notes, ctx.signal);
        return { content: `${args.notes ? 'Set' : 'Cleared'} the speaker notes of slide ${args.slide} in "${file.name}".${backup ? ` A backup from before is in Drive: "${backup}".` : ''}`, summary: `notes on slide ${args.slide}` };
      }
    },
    {
      name: 'slides.replace', capability: 'google', scope: 'write', timeoutMs: 60_000,
      description: 'Exact, case-sensitive find-and-replace on every slide of a deck (not the speaker notes; use slides.notes for those). `find` must be within one line, copied exactly (read the deck first). `count` is how many places you expect (default 1); if the deck has a different number, nothing changes. The user is asked first; a backup copy is saved first if this job didn\'t make the deck.',
      inputSchema: { type: 'object', properties: { fileId: idProp, find: { type: 'string', maxLength: 5000 }, replaceWith: { type: 'string', maxLength: 20_000 }, count: { type: 'integer', minimum: 1, maximum: 1000 } }, required: ['fileId', 'find', 'replaceWith'], additionalProperties: false },
      async assess(args, ctx) {
        if (!args.find) return { error: '`find` is empty. Nothing was done.' };
        if (args.find.includes('\n')) return { error: '`find` can\'t cross a line break: replace one line at a time. Nothing was done.' };
        if (args.find === args.replaceWith) return { error: 'The replacement is the same as the text. Nothing was done.' };
        const l = await lookup(args.fileId, ctx.signal); if (l.error) return l;
        const n = countOccurrences(slides.deckText(await slides.get(l.file.id, ctx.signal)), args.find), want = args.count || 1;
        if (n === 0) return { error: `"${clip(args.find, 120)}" isn't on the slides of ${describe(l.file)} (the match is exact and case-sensitive). Read it with slides.read and copy the text exactly. Nothing was done.` };
        if (n !== want) return { error: `"${clip(args.find, 120)}" is on the slides of ${describe(l.file)} ${n} times, not ${want}. Use a longer, unique piece of text, or set count to ${n} to change them all. Nothing was done.` };
        return { summary: `in ${describe(l.file)}, replace${n > 1 ? ` (${n} places)` : ''}\n  "${clip(args.find, 300)}"\n  → "${clip(args.replaceWith, 300)}"${await backups.note(ctx.runId, l.file.id)}`, facts: { ...l, n } };
      },
      async run(args, ctx, { file, n }) {
        const backup = await backups.first(ctx, file);
        const changed = await slides.replaceAll(file.id, args.find, args.replaceWith, ctx.signal);
        const note = changed === n ? '' : ` (Google changed ${changed}, not ${n}: the deck changed in the meantime, or the text is also in the speaker notes)`;
        return { content: `Replaced ${changed} place(s) in "${file.name}"${note}.${backup ? ` A backup from before is in Drive: "${backup}".` : ''}`, summary: `replaced ${changed} in "${file.name}"`, isError: changed === 0 };
      }
    }
  ];
}
