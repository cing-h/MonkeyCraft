// Tool registry and the dispatch pipeline. Every tool call from every provider
// goes through dispatch(), in this fixed order:
//
//   unknown tool → grant gate → schema validation → assess (hardline + facts)
//   → consent (for anything that isn't a plain read) → run once, with timeout + abort
//
// dispatch() never throws. It returns { ok, isError, content, summary } and
// emits agent.tool_call / agent.tool_result, so the station shows exactly what ran.
//
// Tool shape:
//   { name: 'fs.read', description, inputSchema, capability, scope: 'read'|'write'|'execute',
//     timeoutMs?, assess?(args, ctx) -> { deny?, summary, outsideWorkspace?, cacheKey?, facts? },
//     run(args, ctx, facts) -> { content, summary?, isError? } }

const MAX_CONTENT = 60_000;

/** Validate a small JSON-Schema subset: type object, properties {type, maxLength, minimum, maximum}, required, additionalProperties:false. */
export function validateArgs(schema, args) {
  const errs = [];
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return ['arguments must be an object'];
  const props = schema.properties || {};
  for (const r of schema.required || []) if (args[r] === undefined) errs.push(`missing "${r}"`);
  for (const [k, v] of Object.entries(args)) {
    const p = props[k];
    if (!p) { if (schema.additionalProperties === false) errs.push(`unknown argument "${k}"`); continue; }
    const t = p.type;
    const okType = t === 'integer' ? Number.isInteger(v) : t === 'number' ? Number.isFinite(v) : t === 'array' ? Array.isArray(v) : typeof v === t;
    if (!okType) { errs.push(`"${k}" should be ${t}`); continue; }
    if (p.maxLength !== undefined && v.length > p.maxLength) errs.push(`"${k}" is longer than ${p.maxLength}`);
    if (p.minimum !== undefined && v < p.minimum) errs.push(`"${k}" is below ${p.minimum}`);
    if (p.maximum !== undefined && v > p.maximum) errs.push(`"${k}" is above ${p.maximum}`);
    if (p.enum && !p.enum.includes(v)) errs.push(`"${k}" should be one of ${p.enum.join('|')}`);
  }
  return errs;
}

export const wireName = name => name.replace(/\./g, '_');

export function makeRegistry(tools) {
  const byName = new Map(tools.map(t => [t.name, t]));
  const byWire = new Map(tools.map(t => [wireName(t.name), t]));

  async function dispatch(call, ctx) {
    const { emit, newId } = ctx;
    const callId = call.callId || newId('call');
    const tool = byName.get(call.tool) || byWire.get(call.tool);
    const toolName = tool ? tool.name : String(call.tool);
    const args = (call.args && typeof call.args === 'object' && !Array.isArray(call.args)) ? call.args : {};
    emit('agent.tool_call', { callId, tool: toolName, args });
    const finish = (isError, content, summary) => {
      const text = String(content ?? '');
      const clipped = text.length > MAX_CONTENT ? text.slice(0, MAX_CONTENT) + `\n…[cut: ${text.length - MAX_CONTENT} more characters]` : text;
      emit('agent.tool_result', { callId, tool: toolName, ok: !isError, isError, summary: String(summary || (isError ? 'error' : 'done')).slice(0, 300) });
      return { ok: !isError, isError, content: clipped, summary };
    };
    try {
      if (call.parseError) return finish(true, `Your arguments weren't valid JSON (${call.parseError}). Nothing ran. Send complete arguments.`, 'bad arguments');
      if (!tool) return finish(true, `There is no tool called "${call.tool}".`, 'unknown tool');
      if (!ctx.grants.has(tool.name)) return finish(true, `You don't have the "${tool.name}" tool.`, 'not granted');
      if (call.args !== undefined && args !== call.args) return finish(true, 'Arguments must be a JSON object. Nothing ran.', 'bad arguments');
      const errs = validateArgs(tool.inputSchema, args);
      if (errs.length) return finish(true, `Invalid arguments: ${errs.join('; ')}. Nothing ran.`, 'bad arguments');
      if (ctx.signal?.aborted) return finish(true, 'The job was stopped. Nothing ran.', 'stopped');

      const a = tool.assess ? await tool.assess(args, ctx) : { summary: tool.name };
      if (a.deny) return finish(true, `Blocked by an AutoCraft safety rule: ${a.deny}. This can't be approved; do not retry it.`, `blocked: ${a.deny}`);

      const needsConsent = tool.scope !== 'read';
      if (needsConsent) {
        const allowed = await ctx.consent.request({
          emit, runId: ctx.runId, interactive: ctx.interactive, signal: ctx.signal, callId, tool: tool.name,
          capability: tool.capability, scope: tool.scope, summary: a.summary, outsideWorkspace: !!a.outsideWorkspace, cacheKey: a.cacheKey
        });
        if (!allowed) return finish(true, ctx.signal?.aborted ? 'The job was stopped. Nothing ran.' : 'The user said no. Nothing ran. Do not retry the same action; ask what they would prefer.', 'denied');
      }

      const timeoutMs = Math.min(tool.timeoutMs || 60_000, ctx.maxToolMs || 600_000);
      const ac = new AbortController();
      const onAbort = () => ac.abort(ctx.signal.reason);
      ctx.signal?.addEventListener('abort', onAbort, { once: true });
      let timer;
      try {
        const res = await Promise.race([
          tool.run(args, { ...ctx, signal: ac.signal, callId }, a.facts),
          new Promise((_, rej) => { timer = setTimeout(() => { rej(new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`)); ac.abort('timeout'); }, timeoutMs); }) // reject first, so the timeout wins the race
        ]);
        return finish(!!res.isError, res.content, res.summary);
      } finally { clearTimeout(timer); ctx.signal?.removeEventListener('abort', onAbort); }
    } catch (e) {
      return finish(true, `The tool failed: ${e.message}`, `failed: ${e.message}`);
    }
  }

  return {
    get: name => byName.get(name) || byWire.get(name),
    /** Tools visible to a creature with these grants. */
    list: grants => tools.filter(t => grants.has(t.name)),
    dispatch
  };
}
