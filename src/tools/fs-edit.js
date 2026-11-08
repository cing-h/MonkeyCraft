// fs.edit: change one exact piece of text in a file, for the Writer (and anyone
// granted it). The old text must appear exactly once, so an edit can't land in
// the wrong place. It asks first, keeps an undo copy, and writes durably. Like
// fs.write, `newChars` must match the new text's length, so a cut-off argument
// writes nothing.

import { checkPath } from '../safety/paths.js';
import { writeFileDurable } from '../store/durable.js';

const MAX = 200_000;

export function makeFsEdit({ fsp, pathEnv, undo }) {
  return {
    name: 'fs.edit',
    capability: 'files',
    scope: 'write',
    timeoutMs: 30_000,
    description: 'Replace one exact piece of text in a text file. "old" must appear exactly once. Set "newChars" to the exact number of characters in "new". The user is asked first; an undo copy is kept.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', maxLength: 4096 },
        old: { type: 'string', maxLength: MAX, description: 'The exact text to replace (must appear once)' },
        new: { type: 'string', maxLength: MAX, description: 'The replacement text' },
        newChars: { type: 'integer', minimum: 0, maximum: MAX, description: 'Exactly how many characters "new" has' }
      },
      required: ['path', 'old', 'new', 'newChars'],
      additionalProperties: false
    },
    async assess(args) {
      if (args.new.length !== args.newChars) return { error: `"new" has ${args.new.length} characters but "newChars" says ${args.newChars}, so your arguments were probably cut off. Nothing was changed. Send the edit again.` };
      if (!args.old) return { error: '"old" is empty. Use fs.write to create or replace a whole file. Nothing was changed.' };
      const c = await checkPath(args.path, pathEnv, { write: true });
      if (c.error) return { deny: c.error };
      if (c.hardline) return { deny: c.hardline };
      let text;
      try { text = await fsp.readFile(c.real, 'utf8'); } catch (e) { return { error: `Can't read ${c.real}: ${e.code === 'ENOENT' ? 'it does not exist' : e.code}. Nothing was changed.` }; }
      const n = text.split(args.old).length - 1;
      if (n !== 1) return { error: `"old" appears ${n} times in ${c.real}; it must appear exactly once. Include more surrounding text. Nothing was changed.` };
      const clip = s => (s.length > 300 ? s.slice(0, 300) + '…' : s);
      return { summary: `edit ${c.real}\n- ${clip(args.old)}\n+ ${clip(args.new)}`, outsideWorkspace: c.outsideWorkspace, cacheKey: `write:${c.real}`, facts: { real: c.real } };
    },
    async run(args, ctx, { real }) {
      const text = await fsp.readFile(real, 'utf8');
      if (text.split(args.old).length - 1 !== 1) return { isError: true, content: 'The file changed while you were waiting, and "old" no longer appears exactly once. Nothing was changed.', summary: 'file changed' };
      const saved = await undo.save({ runId: ctx.runId, path: real, op: 'write' });
      ctx.emit('undo.saved', { undoId: saved.undoId, path: real, op: 'write' });
      const data = Buffer.from(text.replace(args.old, () => args.new), 'utf8');
      await writeFileDurable(fsp, real, data);
      await undo.settle(ctx.runId, saved.undoId, data);
      return { content: `edited ${real}. The user can undo this with "Revert this job".`, summary: 'edited' };
    }
  };
}
