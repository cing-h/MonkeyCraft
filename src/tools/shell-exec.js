// shell.exec: run one bash command. Always asks the user first and shows the
// exact command. A session "allow" covers only the same command in the same
// workspace folder. The command runs in its own process group, so a timeout or
// STOP kills everything it started.

import { checkPath } from '../safety/paths.js';
import { checkCommand } from '../safety/shell-guard.js';

const MAX_OUT = 16_000;
const SECRET_ENV = /^(ANTHROPIC_|OPENAI_|AWS_|AZURE_|GH_|GITHUB_TOKEN|MONKEYCRAFT_|CLAUDE_CODE_OAUTH|NPM_TOKEN)/;

export function makeShellExec({ spawn, pathEnv, baseEnv, killProcessGroup }) {
  const env = Object.fromEntries(Object.entries(baseEnv).filter(([k]) => !SECRET_ENV.test(k) && k !== 'CLAUDECODE'));
  return {
    name: 'shell.exec',
    capability: 'shell',
    scope: 'execute',
    timeoutMs: 600_000,
    description: 'Run one bash command and return its exit code and output. The user must approve every command, so explain why you need it. Default folder: the MonkeyCraft workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', maxLength: 8000, description: 'The bash command' },
        cwd: { type: 'string', maxLength: 4096, description: 'Folder to run in (default: the workspace)' },
        timeoutSec: { type: 'integer', minimum: 1, maximum: 600, description: 'Give up after this many seconds (default 60)' }
      },
      required: ['command'],
      additionalProperties: false
    },
    async assess(args) {
      const g = checkCommand(args.command, { extra: [pathEnv.dataDir] });
      if (!g.ok) return { deny: g.reason };
      const c = await checkPath(args.cwd || pathEnv.workspace, pathEnv);
      if (c.error) return { deny: `folder: ${c.error}` };
      if (c.hardline) return { deny: c.hardline };
      const where = c.outsideWorkspace ? ` (in ${c.real})` : '';
      return {
        summary: `$ ${args.command}${where}`,
        outsideWorkspace: c.outsideWorkspace,
        cacheKey: `shell:${c.real}:${args.command}`,
        facts: { cwd: c.real }
      };
    },
    run(args, ctx, { cwd }) {
      const limitMs = (args.timeoutSec || 60) * 1000;
      return new Promise(resolve => {
        let out = '', err = '', cutOut = 0, cutErr = 0, done = false, why = null;
        const child = spawn('bash', ['-c', args.command], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
        const kill = reason => { if (done) return; why = reason; killProcessGroup(child.pid); };
        const timer = setTimeout(() => kill(`timed out after ${args.timeoutSec || 60}s`), limitMs);
        const onAbort = () => kill('stopped');
        ctx.signal?.addEventListener('abort', onAbort, { once: true });
        child.stdout.on('data', d => { const s = d.toString('utf8'); if (out.length < MAX_OUT) out += s; else cutOut += s.length; });
        child.stderr.on('data', d => { const s = d.toString('utf8'); if (err.length < MAX_OUT) err += s; else cutErr += s.length; });
        const end = (code, signal, spawnErr) => {
          if (done) return; done = true; clearTimeout(timer); ctx.signal?.removeEventListener('abort', onAbort);
          if (spawnErr) return resolve({ isError: true, content: `Couldn't start bash: ${spawnErr.message}`, summary: 'spawn failed' });
          const status = why ? `killed (${why})` : signal ? `killed by ${signal}` : `exit code ${code}`;
          const clip = (s, n) => s.slice(0, MAX_OUT) + (n || s.length > MAX_OUT ? `\n…[cut ${n + Math.max(0, s.length - MAX_OUT)} characters]` : '');
          resolve({
            isError: !!why || code !== 0,
            content: `${status}\n--- stdout ---\n${clip(out, cutOut) || '(none)'}\n--- stderr ---\n${clip(err, cutErr) || '(none)'}`,
            summary: status
          });
        };
        child.on('error', e => end(null, null, e));
        child.on('close', (code, signal) => end(code, signal));
      });
    }
  };
}
