// The with/without test runs unattended, so nobody is there to answer
// permission prompts. This policy answers them, and it only ever says yes inside
// the run's throwaway sandbox. The app never uses it: only scripts/eval-brain.js.
//
//   - file changes: allowed inside the sandbox workspace, refused anywhere else
//   - shell.exec:   allowed only when it runs in the sandbox AND the command names
//                   no path outside it (no ~, .., $HOME or absolute paths elsewhere)
//   - verify.run:   allowed in the sandbox and in the listed project folders
//                   (test commands only, by that tool's own allowlist)
//   - Google:       always refused (the test never touches the user's Drive)
// The hardline list still applies before this is ever asked.

export function shellStaysInside(command, sandbox) {
  const c = String(command || '');
  if (/(^|[\s'"=(])~|\.\.|\$HOME|\$\{?HOME|`|\$\(/.test(c)) return false;
  for (const m of c.matchAll(/(?:^|[\s'"=(])(\/[^\s'"|;&)]*)/g)) if (m[1] !== sandbox && !m[1].startsWith(sandbox + '/')) return false;
  return !/[A-Za-z]:\\/.test(c);   // no Windows paths
}

export function makeSandboxConsent({ sandbox, verifyIn = [], log = [] }) {
  const decide = ({ tool, scope, summary = '', outsideWorkspace }) => {
    if (/^(drive|docs|sheets|slides)\./.test(tool)) return [false, 'Google is off in the test'];
    if (tool === 'verify.run') {
      if (!outsideWorkspace) return [true, 'test command in the sandbox'];
      const where = /\(in (.+)\)$/.exec(summary)?.[1] || '';
      return verifyIn.some(d => where === d || where.startsWith(d + '/')) ? [true, 'test command in an allowed project'] : [false, 'outside the sandbox'];
    }
    if (tool === 'shell.exec') {
      if (outsideWorkspace) return [false, 'outside the sandbox'];
      const cmd = summary.replace(/^\$ /, '');
      return shellStaysInside(cmd, sandbox) ? [true, 'command stays in the sandbox'] : [false, 'command names a path outside the sandbox'];
    }
    if (scope === 'write' || scope === 'execute') return outsideWorkspace ? [false, 'outside the sandbox'] : [true, 'inside the sandbox'];
    return [false, 'not allowed in the test'];
  };
  return {
    log,
    async request(req) {
      const [allowed, why] = decide(req);
      log.push({ tool: req.tool, allowed, why, summary: String(req.summary || '').slice(0, 300) });
      return allowed;
    }
  };
}
