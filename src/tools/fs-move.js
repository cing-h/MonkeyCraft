// fs.move: move or rename a file or folder, for the Archivist. Both ends are
// checked (hardline and workspace). It never overwrites: the destination must
// not exist. It asks first, and "Revert this job" moves it back.

import path from 'node:path';
import { checkPath } from '../safety/paths.js';

export function makeFsMove({ fsp, pathEnv, undo }) {
  return {
    name: 'fs.move',
    capability: 'files',
    scope: 'write',
    timeoutMs: 60_000,
    description: 'Move or rename a file or folder. The destination must not exist yet (nothing is overwritten). The user is asked first; "Revert this job" can move it back.',
    inputSchema: {
      type: 'object',
      properties: { from: { type: 'string', maxLength: 4096 }, to: { type: 'string', maxLength: 4096 } },
      required: ['from', 'to'],
      additionalProperties: false
    },
    async assess(args) {
      const a = await checkPath(args.from, pathEnv, { write: true }), b = await checkPath(args.to, pathEnv, { write: true });
      if (a.error || b.error) return { deny: a.error || b.error };
      if (a.hardline || b.hardline) return { deny: a.hardline || b.hardline };
      if (a.real === pathEnv.workspace || a.real === pathEnv.home || a.real === '/') return { deny: 'the workspace, home or root folder itself' };
      try { await fsp.stat(a.real); } catch { return { error: `${a.real} doesn't exist. Nothing was moved.` }; }
      try { await fsp.stat(b.real); return { error: `${b.real} already exists. Moving never overwrites; choose another name. Nothing was moved.` }; } catch {}
      try { await fsp.stat(path.dirname(b.real)); } catch { return { error: `The folder ${path.dirname(b.real)} doesn't exist. Nothing was moved.` }; }
      if ((b.real + '/').startsWith(a.real + '/')) return { error: 'A folder can\'t be moved into itself. Nothing was moved.' };
      return { summary: `move ${a.real}\n  → ${b.real}`, outsideWorkspace: a.outsideWorkspace || b.outsideWorkspace, cacheKey: `move:${a.real}:${b.real}`, facts: { from: a.real, to: b.real } };
    },
    async run(args, ctx, { from, to }) {
      const saved = await undo.saveMove({ runId: ctx.runId, from, to });
      ctx.emit('undo.saved', { undoId: saved.undoId, path: to, op: 'move' });
      await fsp.rename(from, to);
      await undo.settleMove(ctx.runId, saved.undoId);
      return { content: `moved ${from} to ${to}. The user can undo this with "Revert this job".`, summary: `moved ${path.basename(from)}` };
    }
  };
}
