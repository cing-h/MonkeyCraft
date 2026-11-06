// Reads Claude Code's `--output-format stream-json` lines and turns them into
// simple actions for the provider. Pure: feed() takes one parsed JSON object.
//
// Tool calls are NOT taken from this stream. They are reported by
// registry.dispatch() when they actually run, so nothing is double-counted.

export function makeStreamParser({ mcpServer = 'monkeycraft' } = {}) {
  const deltaMsgs = new Set();
  let currentMsg = null;

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
        if (ev.type === 'message_start') { currentMsg = ev.message?.id || null; return []; }
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
