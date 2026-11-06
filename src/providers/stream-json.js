// Reads Claude Code's `--output-format stream-json` lines and turns them into
// simple actions for the provider. Pure: feed() takes one parsed JSON object.
//
// Tool calls are NOT taken from this stream. They are reported by
// registry.dispatch() when they actually run, so nothing is double-counted.

export function makeStreamParser({ mcpServer = 'monkeycraft' } = {}) {
  const deltaMsgs = new Set();
  let currentMsg = null;
  // live token use, so limits can stop a job mid-run: every message_start adds its
  // input tokens; output tokens grow through message_delta (a running total per message)
  const tot = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let doneOut = 0;
  const num = v => (Number.isInteger(v) && v >= 0 ? v : 0);
  const usage = () => ({ kind: 'usage', ...tot });

  function feed(o) {
    if (!o || typeof o !== 'object') return [];
    switch (o.type) {
      case 'system': {
        if (o.subtype === 'init') {
          const srv = (o.mcp_servers || []).find(s => s.name === mcpServer);
          return [{ kind: 'init', model: o.model || null, apiKeySource: o.apiKeySource ?? null, mcpStatus: srv ? srv.status : 'missing', tools: o.tools || [] }];
        }
        if (o.subtype === 'api_retry' || o.subtype === 'retry') {
          return [{ kind: 'retry', attempt: Number.isInteger(o.attempt) ? o.attempt : 1, reason: String(o.error || o.reason || 'retry') }];
        }
        return [];
      }
      case 'stream_event': {
        const ev = o.event || {};
        if (ev.type === 'message_start') {
          currentMsg = ev.message?.id || null;
          const u = ev.message?.usage || {};
          doneOut = tot.output;
          tot.input += num(u.input_tokens); tot.cacheRead += num(u.cache_read_input_tokens); tot.cacheWrite += num(u.cache_creation_input_tokens);
          tot.output = doneOut + num(u.output_tokens);
          return [usage()];
        }
        if (ev.type === 'message_delta' && ev.usage) { tot.output = doneOut + num(ev.usage.output_tokens); return [usage()]; }
        if (ev.type === 'content_block_delta') {
          const d = ev.delta || {};
          if (d.type === 'text_delta' && d.text) { if (currentMsg) deltaMsgs.add(currentMsg); return [{ kind: 'token', text: d.text }]; }
          if (d.type === 'thinking_delta' && d.thinking) return [{ kind: 'reasoning', text: d.thinking }];
        }
        return [];
      }
      case 'assistant': {
        // Without partial messages (or when a message had no deltas), take its text whole.
        const m = o.message || {};
        if (m.id && deltaMsgs.has(m.id)) return [];
        const out = [];
        for (const b of m.content || []) if (b.type === 'text' && b.text) out.push({ kind: 'token', text: b.text });
        if (m.id) deltaMsgs.add(m.id); // a message may arrive in several assistant chunks
        return out;
      }
      case 'result': {
        const u = o.usage || {};
        const n = v => (Number.isInteger(v) ? v : 0);
        let reason = 'error';
        if (o.subtype === 'success' && !o.is_error) reason = 'done';
        else if (o.subtype === 'error_max_turns') reason = 'max_iters';
        else if (/budget/i.test(o.subtype || '')) reason = 'budget';
        return [{
          kind: 'result', reason, text: typeof o.result === 'string' ? o.result : '', subtype: o.subtype || null,
          usd: Number.isFinite(o.total_cost_usd) ? o.total_cost_usd : 0, priced: Number.isFinite(o.total_cost_usd),
          inputTokens: n(u.input_tokens), outputTokens: n(u.output_tokens),
          cacheReadTokens: n(u.cache_read_input_tokens), cacheWriteTokens: n(u.cache_creation_input_tokens),
          turns: n(o.num_turns)
        }];
      }
      default: return [];
    }
  }
  return { feed };
}
