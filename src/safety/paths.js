// Path safety. Reach is the whole computer (user decision), so every path is
// resolved to its real location (symlinks followed) and then checked:
//   1. hardline: never readable or writable, and no prompt can override it
//   2. outsideWorkspace: changes here prompt the user every time
//
// Pure apart from the injected `realpath`.

import path from 'node:path';

/**
 * The hardline list. `home`, `dataDir` and `brainDir` are absolute. The Brain is
 * hardlined for every ordinary tool: only src/brain/* writes it, through its journal.
 * A Brain on a Windows drive is matched case-insensitively, as Windows does.
 */
export function hardlineRules({ home, dataDir, brainDir = null }) {
  const h = p => path.join(home, p);
  const brainWin = brainDir && /^\/mnt\/[a-z]\//i.test(brainDir);
  return {
    prefixes: [
      '/etc', '/usr', '/bin', '/sbin', '/lib', '/lib64', '/boot', '/proc', '/sys', '/dev', '/root',
      h('.ssh'), h('.gnupg'), h('.aws'), h('.azure'), h('.kube'), h('.docker'), h('.config/gh'), h('.config/gcloud'),
      h('.claude'), h('.claude.json'), h('.netrc'), h('.git-credentials'), h('.npmrc'), h('.pypirc'),
      dataDir
    ],
    brain: brainDir ? { dir: brainWin ? brainDir.toLowerCase() : brainDir, caseless: brainWin } : null,
    // Windows drives under WSL: compared case-insensitively
    winPrefixes: ['/mnt/c/windows', '/mnt/c/program files', '/mnt/c/program files (x86)', '/mnt/c/programdata'],
    // any segment sequence matching these, case-insensitive (for every Windows user)
    winPatterns: [/^\/mnt\/[a-z]\/users\/[^/]+\/appdata(\/|$)/, /^\/mnt\/[a-z]\/users\/[^/]+\/\.(ssh|aws|azure|claude)(\/|$)/],
    basenames: [/^\.env($|\.)/i, /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/, /\.(pem|key|p12|pfx|kdbx)$/i, /^\.credentials\.json$/]
  };
}

const under = (p, prefix) => p === prefix || p.startsWith(prefix.endsWith('/') ? prefix : prefix + '/');

/** Returns the reason a real absolute path is hardlined, or null. */
export function hardlineReason(real, rules) {
  if (rules.brain && under(rules.brain.caseless ? real.toLowerCase() : real, rules.brain.dir)) return 'the Brain (only the brain tools may use it, so every change is journaled)';
  for (const pre of rules.prefixes) if (under(real, pre)) return `protected location ${pre}`;
  const lower = real.toLowerCase();
  for (const pre of rules.winPrefixes) if (under(lower, pre)) return `protected Windows location ${pre}`;
  for (const re of rules.winPatterns) if (re.test(lower)) return 'protected Windows user data (AppData or credentials)';
  for (const seg of real.split('/')) for (const re of rules.basenames) if (re.test(seg)) return `protected file name "${seg}" (secrets)`;
  return null;
}

export function isInside(real, dir) { return under(real, dir); }

/**
 * Resolve user/model input to a real absolute path. `~` expands to home; a
 * relative path is taken from the workspace. If the path doesn't exist yet, the
 * nearest existing parent is resolved, so a symlinked parent can't hide where a
 * new file would land. Returns { real } or { error }.
 */
export async function resolveReal(input, { home, workspace, realpath }) {
  if (typeof input !== 'string' || !input.trim()) return { error: 'empty path' };
  if (input.includes('\0')) return { error: 'path contains a NUL byte' };
  let p = input.trim();
  if (p === '~' || p.startsWith('~/')) p = path.join(home, p.slice(1));
  const abs = path.resolve(workspace, p);
  let cur = abs; const rest = [];
  for (let i = 0; i < 256; i++) {
    try { const r = await realpath(cur); return { real: rest.length ? path.join(r, ...rest.reverse()) : r }; }
    catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') return { error: `cannot resolve: ${e.code || e.message}` };
      const parent = path.dirname(cur); if (parent === cur) return { error: 'cannot resolve path' };
      rest.push(path.basename(cur)); cur = parent;
    }
  }
  return { error: 'path too deep' };
}

/** One-stop check: { real, hardline: reason|null, outsideWorkspace } or { error }. */
export async function checkPath(input, env) {
  const r = await resolveReal(input, env);
  if (r.error) return r;
  return { real: r.real, hardline: hardlineReason(r.real, env.rules), outsideWorkspace: !isInside(r.real, env.workspace) };
}
