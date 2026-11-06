// Child processes MonkeyCraft starts (Claude Code CLIs and shell commands).
// Their PIDs are saved durably in data/children.json. If MonkeyCraft crashes,
// the next start kills any that are still running. It first checks each
// process's command line, so an unrelated process that later reused the PID is
// never touched. Injected IO: fsp, readCmdline(pid) -> string|null, kill(pid).

import { writeFileDurable } from '../store/durable.js';

export function makeChildTracker({ fsp, file, readCmdline, kill, log = () => {} }) {
  const live = new Map(); // pid -> { pid, kind, match }
  let chain = Promise.resolve();
  const save = () => (chain = chain.then(() => writeFileDurable(fsp, file, JSON.stringify([...live.values()]) + '\n')).catch(e => log(`[children] save failed: ${e.message}`)));
  return {
    add(pid, kind, match) { if (!Number.isInteger(pid) || pid <= 1 || !match) return; live.set(pid, { pid, kind, match: String(match) }); save(); },
    remove(pid) { if (live.delete(pid)) save(); },
    live: () => [...live.values()],
    /** At startup: kill leftovers from a previous run of MonkeyCraft. Returns the ones killed. */
    async reapLeftovers() {
      let list = [];
      try { list = JSON.parse(await fsp.readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') log(`[children] unreadable list: ${e.message}`); }
      const killed = [];
      for (const c of Array.isArray(list) ? list : []) {
        if (!c || !Number.isInteger(c.pid) || c.pid <= 1 || typeof c.match !== 'string' || !c.match) continue;
        const cmd = await readCmdline(c.pid);
        if (cmd && cmd.includes(c.match)) { kill(c.pid); killed.push(c); }
      }
      live.clear(); save();
      await chain;
      return killed;
    },
    flush: () => chain
  };
}
