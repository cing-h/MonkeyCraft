// fs.read: read a text file or list a folder, anywhere that isn't hardlined.
// Reading never changes anything, so it needs no prompt.

import { checkPath } from '../safety/paths.js';

const DEFAULT_BYTES = 64 * 1024, MAX_BYTES = 256 * 1024, MAX_ENTRIES = 500;

export function makeFsRead({ fsp, pathEnv }) {
  return {
    name: 'fs.read',
    capability: 'files',
    scope: 'read',
    timeoutMs: 15_000,
    description: 'Read a text file, or list the contents of a folder. Relative paths start in the MonkeyCraft workspace; ~ is the home folder.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', maxLength: 4096, description: 'File or folder path' },
        maxBytes: { type: 'integer', minimum: 1, maximum: MAX_BYTES, description: `Read at most this many bytes (default ${DEFAULT_BYTES})` }
      },
      required: ['path'],
      additionalProperties: false
    },
    async assess(args) {
      const c = await checkPath(args.path, pathEnv);
      if (c.error) return { deny: c.error };
      if (c.hardline) return { deny: c.hardline };
      return { summary: `read ${c.real}`, outsideWorkspace: c.outsideWorkspace, facts: { real: c.real } };
    },
    async run(args, ctx, { real }) {
      let st;
      try { st = await fsp.stat(real); } catch (e) { return { isError: true, content: `Can't read ${real}: ${e.code === 'ENOENT' ? 'it does not exist' : e.code}`, summary: 'not found' }; }
      if (st.isDirectory()) {
        const ents = await fsp.readdir(real, { withFileTypes: true });
        ents.sort((a, b) => a.name.localeCompare(b.name));
        const lines = ents.slice(0, MAX_ENTRIES).map(e => e.name + (e.isDirectory() ? '/' : e.isSymbolicLink() ? '@' : ''));
        if (ents.length > MAX_ENTRIES) lines.push(`…and ${ents.length - MAX_ENTRIES} more`);
        return { content: `Folder ${real} (${ents.length} entries):\n${lines.join('\n') || '(empty)'}`, summary: `listed ${ents.length} entries` };
      }
      if (!st.isFile()) return { isError: true, content: `${real} is not a regular file.`, summary: 'not a file' };
      const want = Math.min(args.maxBytes || DEFAULT_BYTES, MAX_BYTES);
      const fh = await fsp.open(real, 'r');
      try {
        const buf = Buffer.alloc(Math.min(want, st.size));
        const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
        const b = buf.subarray(0, bytesRead);
        if (b.includes(0)) return { content: `${real} looks like a binary file (${st.size} bytes); not shown.`, summary: 'binary file' };
        const more = st.size > bytesRead ? `\n…[file continues: ${st.size - bytesRead} more bytes]` : '';
        return { content: b.toString('utf8') + more, summary: `read ${bytesRead} of ${st.size} bytes` };
      } finally { await fh.close(); }
    }
  };
}
