// A tiny in-memory stand-in for node:fs/promises, enough for the durable-write,
// grants, children and undo modules. Paths are plain strings; folders are implicit
// except where mkdir/stat need them.
export function memFs(initial = {}) {
  const files = new Map(Object.entries(initial).map(([k, v]) => [k, Buffer.from(v)]));
  const dirs = new Set(['/']);
  const enoent = p => Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
  const handle = (p, flag) => {
    if (flag === 'w') files.set(p, Buffer.alloc(0));
    if (flag === 'a' && !files.has(p)) files.set(p, Buffer.alloc(0));
    return {
      async writeFile(d) { files.set(p, Buffer.from(d)); },
      async write(d) { files.set(p, Buffer.concat([files.get(p) || Buffer.alloc(0), Buffer.from(d)])); },
      async sync() {}, async close() {}
    };
  };
  return {
    files, dirs,
    async open(p, flag = 'r') { if (flag === 'r' && !files.has(p) && !dirs.has(p)) throw enoent(p); return handle(p, flag); },
    async readFile(p, enc) { if (!files.has(p)) throw enoent(p); const b = files.get(p); return enc ? b.toString(enc) : Buffer.from(b); },
    async writeFile(p, d) { files.set(p, Buffer.from(d)); },
    async rename(a, b) { if (!files.has(a)) throw enoent(a); files.set(b, files.get(a)); files.delete(a); },
    async unlink(p) { if (!files.delete(p)) throw enoent(p); },
    async mkdir(p) { dirs.add(p); },
    async stat(p) { if (files.has(p)) return { isFile: () => true, isDirectory: () => false, size: files.get(p).length }; if (dirs.has(p)) return { isFile: () => false, isDirectory: () => true, size: 0 }; throw enoent(p); }
  };
}
