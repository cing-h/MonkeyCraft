// Hardline checks for shell commands. These are refused outright, before any
// prompt. Everything else still needs the user's OK (shell.exec always prompts).
// A text check can't prove a command is safe; it only catches the obviously
// catastrophic or secret-touching ones. The prompt is the real safeguard.

const RULES = [
  [/\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*[rR][a-zA-Z]*\s+(-[a-zA-Z]*\s+)*(\/|~\/?|\$HOME\/?|\/mnt\/[a-z]\/?)(\*|\s|$)/, 'recursive delete of a root, home or drive'],
  [/\bmkfs(\.\w+)?\b/, 'formatting a filesystem'],
  [/\bdd\b[^|;&]*\bof=\/dev\//, 'writing raw to a device'],
  [/>\s*\/dev\/(sd|nvme|hd|vd)/, 'writing raw to a disk'],
  [/\b(shutdown|reboot|poweroff|halt|init\s+0)\b/, 'shutting down the computer'],
  [/\bformat(\.com)?\s+[a-z]:/i, 'formatting a Windows drive'],
  [/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, 'fork bomb'],
  [/\bchmod\s+(-[a-zA-Z]*\s+)*-?R?\s*[0-7]*7{2}[0-7]?\s+\/(\s|$)/, 'opening permissions on /'],
  [/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/, 'piping a download straight into a shell'],
  [/\bsudo\b/, 'sudo (MonkeyCraft never runs as administrator)'],
  [/(~|\$HOME|\/home\/[^/\s]+|\/root)\/\.(ssh|gnupg|aws|azure|kube|docker|claude|netrc|git-credentials)\b/, 'touching saved keys or credentials'],
  [/\.credentials\.json|\bid_(rsa|ed25519|ecdsa|dsa)\b/, 'touching saved keys or credentials'],
  [/\/mnt\/[a-z]\/(windows|program\s*files)/i, 'touching Windows system folders']
];

/** Returns { ok: true } or { ok: false, reason }. `extra` holds paths that must never appear (MonkeyCraft's data dir, the Brain), matched case-insensitively. */
// `readOnly` holds the spellings of read-only folders: a command can't be told apart into reading and writing, so a command naming one is refused (fs.read still reads them).
export function checkCommand(cmd, { extra = [], readOnly = [] } = {}) {
  if (typeof cmd !== 'string' || !cmd.trim()) return { ok: false, reason: 'empty command' };
  if (cmd.includes('\0')) return { ok: false, reason: 'command contains a NUL byte' };
  for (const [re, reason] of RULES) if (re.test(cmd)) return { ok: false, reason };
  const low = cmd.toLowerCase();
  for (const p of extra) if (p && low.includes(String(p).toLowerCase())) return { ok: false, reason: `touching MonkeyCraft's own records (${p})` };
  for (const p of readOnly) if (p && low.includes(String(p).toLowerCase())) return { ok: false, reason: `${p} is read-only for the crew, and a command could change it (use fs.read to read it)` };
  return { ok: true };
}
