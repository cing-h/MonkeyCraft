// Reads Claude Code's `--output-format stream-json` lines and turns them into
// simple actions for the provider. Pure: feed() takes one parsed JSON object.
//
// MonkeyCraft's own tool calls are NOT taken from this stream. They are
// reported by registry.dispatch() when they actually run, so nothing is
// double-counted. The exception is Claude Code's own built-in tools that a
// creature is allowed (the Scout's web search): those never reach dispatch, so
// they are reported from here ('builtin_call' / 'builtin_result').

export function makeStreamParser({ mcpServer = 'monkeycraft' } = {}) {
  const deltaMsgs = new Set();
  const builtinSeen = new Set(), builtinOpen = new Map(); // tool_use id -> name
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
        const m = o.message || {}, out = [];
        // built-in tool uses (never MonkeyCraft's own mcp__ tools, which dispatch reports)
        for (const b of m.content || []) {
          if (b.type !== 'tool_use' && b.type !== 'server_tool_use') continue;
          if (!b.id || builtinSeen.has(b.id) || String(b.name || '').startsWith('mcp__')) continue;
          builtinSeen.add(b.id); builtinOpen.set(b.id, String(b.name));
          out.push({ kind: 'builtin_call', id: b.id, name: String(b.name), input: b.input && typeof b.input === 'object' ? b.input : {} });
        }
        // Without partial messages (or when a message had no deltas), take its text whole.
        if (!(m.id && deltaMsgs.has(m.id))) {
          for (const b of m.content || []) if (b.type === 'text' && b.text) out.push({ kind: 'token', text: b.text });
          if (m.id) deltaMsgs.add(m.id); // a message may arrive in several assistant chunks
        }
        for (const b of m.content || []) if (b.type === 'web_search_tool_result' && builtinOpen.has(b.tool_use_id)) out.push(closeBuiltin(b.tool_use_id, false, b.content));
        return out;
      }
      case 'user': {
        const out = [];
        const content = Array.isArray(o.message?.content) ? o.message.content : [];
        for (const b of content) if (b.type === 'tool_result' && builtinOpen.has(b.tool_use_id)) out.push(closeBuiltin(b.tool_use_id, !!b.is_error, b.content));
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
  function closeBuiltin(id, isError, content) {
    const name = builtinOpen.get(id); builtinOpen.delete(id);
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map(c => c.text || c.title || c.url || '').filter(Boolean).join(' ') : '';
    return { kind: 'builtin_result', id, name, isError, text: text.slice(0, 500) };
  }
  /** Built-in calls still open when the run ended (the stream never showed their result). */
  const openBuiltins = () => [...builtinOpen.entries()].map(([id, name]) => ({ id, name }));
  return { feed, openBuiltins };
}
