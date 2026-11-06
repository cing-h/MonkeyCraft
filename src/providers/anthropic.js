// Provider: the Anthropic API with an API key, for people who don't use their
// own Claude Code subscription. It runs MonkeyCraft's own agent loop, and
// every tool call goes through the SAME dispatch pipeline as the Claude Code
// provider (ctx.tools.callTool → registry.dispatch): permissions, lockout,
// loop breaker and undo all apply unchanged.
//
// The loop: stream one turn (streamed text → agent.token, live usage →
// onUsage) → if Claude asked for tools, run them one at a time and send all
// results back in a single user message → repeat until it stops, hits the
// turn limit or the spending limit, or the job is stopped.
//
// - The Scout's web search uses the API's own server-side web search tool. It
//   is reported as web.search events and taints the job, just like the Claude
//   Code provider's built-in search.
// - Requests use prompt caching (top-level cache_control) and, on models that
//   support it, the server-side refusal fallback ("default" routing).
// - Tool inputs stream eagerly. They are validated by the registry before
//   anything runs, and a turn cut off at max_tokens never runs its tools.
//
// Injected: makeClient(apiKey) -> Anthropic client (tests pass a fake).

import Anthropic from '@anthropic-ai/sdk';

// $ per million tokens (input, output, cache read). Cache writes cost 1.25 × input.
export const PRICES = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 }
};
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);
const MAX_TURNS = 40, MAX_TOKENS = 64_000, MAX_JSON_RETRIES = 2;

export function costUsd(model, u) {
  const p = PRICES[model]; if (!p) return { usd: 0, priced: false };
  const usd = (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.input * 1.25) / 1e6;
  return { usd, priced: true };
}

export function makeAnthropicProvider({ apiKey, makeClient = key => new Anthropic({ apiKey: key }) }) {
  const client = apiKey ? makeClient(apiKey) : null;
  return {
    id: 'anthropic-api',
    available: !!apiKey,
    /** Resolves { reason, usd, priced, tokens, turns, billing, text } and never rejects. */
    async run({ agent, prompt, signal, emit, tools: local, maxBudgetUsd = 2, onUsage = () => {}, onTaint = () => {} }) {
      const tot = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      let turns = 0, text = '', reason = 'done', jsonRetries = 0;
      const done = r => {
        const c = costUsd(agent.model, tot);
        if (turns) emit('agent.cost', { usd: c.usd, priced: c.priced, inputTokens: tot.input, outputTokens: tot.output, cacheReadTokens: tot.cacheRead, cacheWriteTokens: tot.cacheWrite, billing: 'api' });
        return { reason: r, usd: c.usd, priced: c.priced, tokens: tot.input + tot.output + tot.cacheRead + tot.cacheWrite, turns, billing: 'api', text };
      };
      const stopped = () => (signal?.reason === 'halt' ? 'halted' : signal?.reason === 'budget' || signal?.reason === 'stale' ? signal.reason : 'cancelled');
      if (!client) { emit('run.error', { message: 'No Anthropic API key is set, so this crew member can\'t use the API. Set ANTHROPIC_API_KEY before starting MonkeyCraft, or switch it to Claude Code in Settings.', code: 'no_api_key' }); return done('error'); }
      if (!PRICES[agent.model]) emit('run.error', { message: `MonkeyCraft has no price for ${agent.model}, so its spending limit can't be checked in dollars.`, code: 'unpriced_model' });

      const toolDefs = (local?.listTools() || []).map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema, eager_input_streaming: true }));
      if ((agent.builtinTools || []).includes('WebSearch')) toolDefs.push({ type: 'web_search_20260209', name: 'web_search', max_uses: 8 });
      const messages = [{ role: 'user', content: prompt }];
      const seenServer = new Set();

      while (true) {
        if (signal?.aborted) return done(stopped());
        if (turns >= MAX_TURNS) { emit('run.error', { message: `Stopped after ${MAX_TURNS} turns.`, code: 'max_turns' }); return done('max_iters'); }
        if (costUsd(agent.model, tot).usd >= maxBudgetUsd) { emit('run.error', { message: `Reached this job's spending limit ($${maxBudgetUsd}).`, code: 'budget' }); return done('budget'); }
        turns++;
        const base = { input: tot.input, cacheRead: tot.cacheRead, cacheWrite: tot.cacheWrite, output: tot.output };
        const params = {
          model: agent.model, max_tokens: MAX_TOKENS, system: agent.systemPrompt, messages, tools: toolDefs,
          cache_control: { type: 'ephemeral' },
          ...(FALLBACK_MODELS.has(agent.model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {})
        };
        let message;
        try {
          const stream = (FALLBACK_MODELS.has(agent.model) ? client.beta.messages : client.messages).stream(params, { signal });
          for await (const ev of stream) {
            if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) { text += ev.delta.text; emit('agent.token', { text: ev.delta.text }); }
            else if (ev.type === 'message_start' && ev.message?.usage) {
              const u = ev.message.usage;
              tot.input = base.input + (u.input_tokens || 0); tot.cacheRead = base.cacheRead + (u.cache_read_input_tokens || 0); tot.cacheWrite = base.cacheWrite + (u.cache_creation_input_tokens || 0); tot.output = base.output + (u.output_tokens || 0);
              onUsage({ ...tot });
            } else if (ev.type === 'message_delta' && ev.usage) { tot.output = base.output + (ev.usage.output_tokens || 0); onUsage({ ...tot }); }
          }
          message = await stream.finalMessage();
          jsonRetries = 0;
        } catch (e) {
          if (signal?.aborted) return done(stopped());
          if (e instanceof Anthropic.APIError) {
            const why = e instanceof Anthropic.AuthenticationError ? 'the API key was refused' : e instanceof Anthropic.RateLimitError ? 'the API is rate-limiting this key; try again shortly' : `${e.status || ''} ${e.message}`.trim();
            emit('run.error', { message: `The Anthropic API failed: ${why}.`, code: `api_${e.status || 'error'}` }); return done('error');
          }
          if (jsonRetries++ < MAX_JSON_RETRIES) { turns--; continue; }   // a tool input that couldn't be parsed at all: re-issue the turn
          emit('run.error', { message: `The API stream failed: ${e.message}`, code: 'stream_failed' }); return done('error');
        }

        // server-side web search: report it like any tool, and taint the job
        for (const b of message.content) {
          if (b.type === 'server_tool_use' && !seenServer.has(b.id)) { seenServer.add(b.id); emit('agent.tool_call', { callId: b.id, tool: 'web.search', args: b.input || {} }); }
          if (b.type === 'web_search_tool_result' && seenServer.has(b.tool_use_id)) {
            const failed = !Array.isArray(b.content);
            emit('agent.tool_result', { callId: b.tool_use_id, tool: 'web.search', ok: !failed, isError: failed, summary: failed ? `search failed (${b.content?.error_code || 'error'})` : `${b.content.length} results` });
            if (!failed) onTaint('web.search');
          }
        }
        if (message.stop_reason === 'refusal') {
          emit('run.error', { message: `Claude declined this request${message.stop_details?.category ? ` (${message.stop_details.category})` : ''}.`, code: 'refusal' }); return done('error');
        }
        if (message.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: message.content }); continue; }
        const uses = message.content.filter(b => b.type === 'tool_use');
        if (!uses.length) return done('done');
        if (message.stop_reason === 'max_tokens') { emit('run.error', { message: 'A reply was cut off before its tool request finished, so nothing ran.', code: 'max_tokens' }); return done('error'); }
        messages.push({ role: 'assistant', content: message.content });
        const results = [];
        for (const u of uses) {   // one at a time, so permission questions come in order; all results go back together
          if (signal?.aborted) return done(stopped());
          const r = await local.callTool(u.name, u.input && typeof u.input === 'object' ? u.input : {});
          results.push({ type: 'tool_result', tool_use_id: u.id, content: String(r.content ?? ''), ...(r.isError ? { is_error: true } : {}) });
        }
        messages.push({ role: 'user', content: results });
      }
    }
  };
}
