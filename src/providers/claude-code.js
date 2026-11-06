// Provider: the user's own signed-in Claude Code CLI, run headless.
//
// Claude Code is started with every built-in tool switched off (--tools "")
// and only MonkeyCraft's MCP server available (--strict-mcp-config). So it can
// think, but every action goes through MonkeyCraft's dispatch pipeline.
// The one exception is a read-only built-in a creature is explicitly given
// (the Scout's WebSearch, by the user's choice). It is reported on screen from
// the stream, and it marks the job as having read web content.
// The API key is removed from its environment, so it uses the user's
// subscription login (personal use only; future users take the API-key provider).

import { makeStreamParser } from './stream-json.js';

const STRIP_ENV = new Set(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT']);

// Built-ins a creature may be given. Read-only, and each one taints the job.
export const BUILTINS = { WebSearch: { tool: 'web.search', taints: true } };

export function buildArgs({ agent, mcpConfig, maxBudgetUsd }) {
  const builtins = (agent.builtinTools || []).filter(n => BUILTINS[n]);
  return [
    '-p',
    '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--model', agent.model,
    '--system-prompt', agent.systemPrompt,
    '--no-session-persistence',
    '--max-budget-usd', String(maxBudgetUsd),
    '--permission-mode', 'dontAsk',
    '--strict-mcp-config',
    '--mcp-config', JSON.stringify(mcpConfig),
    '--allowedTools', ['mcp__monkeycraft', ...builtins].join(','),
    '--tools', builtins.join(',')
  ];
}

export function makeClaudeCodeProvider({ spawn, claudePath, baseEnv, killProcessGroup, cwd, graceMs = 3000 }) {
  const env = Object.fromEntries(Object.entries(baseEnv).filter(([k]) => !STRIP_ENV.has(k)));
  env.MCP_TOOL_TIMEOUT = '1800000'; // a tool may wait a long time for the user's permission
  env.MCP_TIMEOUT = '30000';

  return {
    id: 'claude-code',
    /**
     * Run one job. The prompt goes in on stdin. Events go out through `emit`.
     * Resolves { reason, usd, priced, tokens, turns, billing, text } and never rejects.
     */
    run({ agent, prompt, mcpConfig, signal, emit, maxBudgetUsd = 2, onUsage = () => {}, onTaint = () => {} }) {
      return new Promise(resolve => {
        const parser = makeStreamParser();
        let buf = '', stderr = '', result = null, billing = 'unknown', settled = false, killTimer = null, initSeen = false;
        const child = spawn(claudePath, buildArgs({ agent, mcpConfig, maxBudgetUsd }), { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });

        const stop = () => {
          try { child.kill('SIGTERM'); } catch {}
          killTimer = setTimeout(() => killProcessGroup(child.pid), graceMs);
        };
        signal?.addEventListener('abort', stop, { once: true });

        const handle = o => {
          for (const a of parser.feed(o)) {
            if (a.kind === 'token') emit('agent.token', { text: a.text });
            else if (a.kind === 'reasoning') emit('agent.reasoning', { text: a.text });
            else if (a.kind === 'usage') onUsage(a);
            else if (a.kind === 'builtin_call') {
              const b = BUILTINS[a.name] || { tool: `builtin.${a.name}`, taints: true };
              emit('agent.tool_call', { callId: a.id, tool: b.tool, args: a.input });
            } else if (a.kind === 'builtin_result') {
              const b = BUILTINS[a.name] || { tool: `builtin.${a.name}`, taints: true };
              emit('agent.tool_result', { callId: a.id, tool: b.tool, ok: !a.isError, isError: a.isError, summary: a.isError ? 'search failed' : 'searched the web' });
              if (b.taints && !a.isError) onTaint(b.tool);
            }
            else if (a.kind === 'retry') emit('provider.retry', { attempt: a.attempt, reason: a.reason });
            else if (a.kind === 'init') {
              initSeen = true;
              billing = a.apiKeySource === 'none' ? 'subscription' : a.apiKeySource ? 'api' : 'unknown';
              if (a.mcpStatus !== 'connected') emit('run.error', { message: `Claude Code could not reach MonkeyCraft's tools (status: ${a.mcpStatus}).`, code: 'mcp_unavailable' });
            } else if (a.kind === 'result') result = a;
          }
        };
        child.stdout.on('data', d => {
          buf += d.toString('utf8');
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i); buf = buf.slice(i + 1);
            if (!line.trim()) continue;
            try { handle(JSON.parse(line)); } catch { /* a non-JSON line (a warning): ignore */ }
          }
        });
        child.stderr.on('data', d => { stderr = (stderr + d.toString('utf8')).slice(-4000); });

        const finish = (code, spawnErr) => {
          if (settled) return; settled = true;
          clearTimeout(killTimer); signal?.removeEventListener('abort', stop);
          if (spawnErr) emit('run.error', { message: `Couldn't start Claude Code (${claudePath}): ${spawnErr.message}`, code: 'spawn_failed' });
          let reason = result ? result.reason : 'error';
          if (signal?.aborted) reason = signal.reason === 'halt' ? 'halted' : signal.reason === 'budget' || signal.reason === 'stale' ? signal.reason : 'cancelled';
          else if (!result && !spawnErr) emit('run.error', { message: `Claude Code exited (code ${code}) without a result.${stderr ? ' ' + stderr.trim().split('\n').slice(-3).join(' ') : ''}`, code: initSeen ? 'no_result' : 'cli_failed' });
          else if (result && result.reason !== 'done' && result.text) emit('run.error', { message: result.text.slice(0, 500), code: result.subtype || 'error' });
          for (const o of parser.openBuiltins()) { const b = BUILTINS[o.name] || { tool: `builtin.${o.name}` }; emit('agent.tool_result', { callId: o.id, tool: b.tool, ok: true, isError: false, summary: 'finished', effectUnknown: true }); onTaint(b.tool); }
          const r = result || { usd: 0, priced: false, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, turns: 0, text: '' };
          if (result) emit('agent.cost', { usd: r.usd, priced: r.priced, inputTokens: r.inputTokens, outputTokens: r.outputTokens, cacheReadTokens: r.cacheReadTokens, cacheWriteTokens: r.cacheWriteTokens, billing });
          resolve({ reason, usd: r.usd, priced: r.priced, tokens: r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens, turns: r.turns, billing, text: r.text });
        };
        child.on('error', e => finish(null, e));
        child.on('close', code => finish(code));
        child.stdin.on('error', () => {});
        child.stdin.end(prompt);
      });
    }
  };
}
