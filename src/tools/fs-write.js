// fs.write: create, replace or append to a text file, anywhere that isn't
// hardlined. It always asks first (outside the workspace: every time), saves
// an undo copy before changing anything, and writes durably.
//
// Cut-off arguments: the creature must say how many characters it is sending
// (`chars`). If the content that arrives is a different length, it was cut off
// on the way, so nothing is written and the creature is told to send it again.
// A cut-off file is never "repaired" by guessing the end.

import path from 'node:path';
import { checkPath } from '../safety/paths.js';
import { writeFileDurable } from '../store/durable.js';

const MAX_CHARS = 1_000_000;

export function makeFsWrite({ fsp, pathEnv, undo }) {
  return {
    name: 'fs.write',
    capability: 'files',
    scope: 'write',
    timeoutMs: 30_000,
    description: 'Create, replace or append to a text file. The user is asked first, and an undo copy is kept. Relative paths start in the MonkeyCraft workspace. Set "chars" to the exact number of characters in "content".',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', maxLength: 4096, description: 'File path' },
        content: { type: 'string', maxLength: MAX_CHARS, description: 'The text to write' },
        chars: { type: 'integer', minimum: 0, maximum: MAX_CHARS, description: 'Exactly how many characters "content" has (a check against cut-off arguments)' },
        mode: { type: 'string', enum: ['create', 'replace', 'append'], description: 'create: a new file only; replace: overwrite the file; append: add to the end' }
      },
      required: ['path', 'content', 'chars', 'mode'],
      additionalProperties: false
    },
    async assess(args) {
      if (args.content.length !== args.chars) return { error: `"content" has ${args.content.length} characters but "chars" says ${args.chars}, so your arguments were probably cut off. Nothing was written. Send the whole content again.` };
      const c = await checkPath(args.path, pathEnv);
      if (c.error) return { deny: c.error };
      if (c.hardline) return { deny: c.hardline };
      let exists = false;
      try { const st = await fsp.stat(c.real); if (!st.isFile()) return { error: `${c.real} exists and isn't a regular file. Nothing was written.` }; exists = true; }
      catch (e) { if (e.code !== 'ENOENT') return { error: `Can't check ${c.real}: ${e.code}. Nothing was written.` }; }
      if (args.mode === 'create' && exists) return { error: `${c.real} already exists. Use mode "replace" to overwrite it or "append" to add to it. Nothing was written.` };
      if (args.mode !== 'create' && !exists) return { error: `${c.real} doesn't exist yet. Use mode "create". Nothing was written.` };
      if (!exists) {
        const parent = await checkPath(path.dirname(c.real), pathEnv);
        if (parent.outsideWorkspace) { try { await fsp.stat(path.dirname(c.real)); } catch { return { error: `The folder ${path.dirname(c.real)} doesn't exist. Outside the workspace, MonkeyCraft only writes into folders that already exist. Nothing was written.` }; } }
      }
      const verb = { create: 'create', replace: 'replace', append: 'append to' }[args.mode];
      const preview = args.content.length > 400 ? args.content.slice(0, 400) + `\n…(${args.content.length - 400} more characters)` : args.content;
      return {
        summary: `${verb} ${c.real} (${args.chars} characters)\n${preview}`,
        outsideWorkspace: c.outsideWorkspace,
        cacheKey: `write:${c.real}`,
        facts: { real: c.real }
      };
    },
    async run(args, ctx, { real }) {
      const saved = await undo.save({ runId: ctx.runId, path: real, op: 'write' });
      ctx.emit('undo.saved', { undoId: saved.undoId, path: real, op: 'write' });
      if (!saved.existed) await fsp.mkdir(path.dirname(real), { recursive: true });
      const data = Buffer.from(args.mode === 'append' ? (await fsp.readFile(real, 'utf8')) + args.content : args.content, 'utf8');
      await writeFileDurable(fsp, real, data);
      await undo.settle(ctx.runId, saved.undoId, data);
      const did = { create: 'created', replace: 'replaced', append: 'appended to' }[args.mode];
      return { content: `${did} ${real} (${args.chars} characters). The user can undo this with "Revert this job".`, summary: `${did} ${path.basename(real)}` };
    }
  };
}
