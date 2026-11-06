// AutoCraft event contract, version 1.
//
// Every real thing the harness does is reported as one of these events. The UI
// (chat log and station floor) may animate ONLY from these events: if it is not
// in the stream, it did not happen.
//
// FROZEN: this contract is additive-only. You may add a new event type or a new
// OPTIONAL field. You may never rename or remove a type or field, change a
// field's kind, or make an optional field required. test/events.test.js holds a
// snapshot that fails on any breaking change.
//
// Pure module: no clock, no IO. Callers pass `ts` in.

export const CONTRACT_VERSION = 1;

// Field kinds: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'any'
// or an array of allowed string values (an enum). A trailing '?' marks a field optional.
const RUN_END_REASONS = ['done', 'cancelled', 'error', 'max_iters', 'budget', 'halted', 'stale'];
const DECISIONS = ['allow_once', 'allow_session', 'allow_always', 'deny'];

const TYPES = {
  // run lifecycle
  'run.start': { trigger: ['user', 'crew', 'schedule', 'recovery'], provider: 'string', model: 'string', parentRunId: 'string?', task: 'string?' },
  'run.end': { reason: RUN_END_REASONS, usd: 'number', tokens: 'integer', turns: 'integer' },
  'run.error': { message: 'string', code: 'string?' },

  // model output
  'agent.token': { text: 'string' },
  'agent.reasoning': { text: 'string' },
  'agent.cost': { usd: 'number', priced: 'boolean', inputTokens: 'integer', outputTokens: 'integer', cacheReadTokens: 'integer?', cacheWriteTokens: 'integer?', billing: 'string?' }, // billing: 'api' | 'subscription' | 'unknown'
  'agent.waiting': { why: ['permission', 'budget', 'concurrency', 'provider'] },
  'agent.compact': { beforeTokens: 'integer', afterTokens: 'integer' },

  // tools
  'agent.tool_call': { callId: 'string', tool: 'string', args: 'object' },
  'agent.tool_result': { callId: 'string', tool: 'string', ok: 'boolean', isError: 'boolean', summary: 'string', effectUnknown: 'boolean?' },

  // permission (consent)
  'permission.prompt': { promptId: 'string', callId: 'string', tool: 'string', capability: 'string', scope: ['read', 'write', 'execute'], summary: 'string', outsideWorkspace: 'boolean' },
  'permission.response': { promptId: 'string', decision: DECISIONS, by: ['user', 'rule', 'hardline', 'autonomous'] },

  // safety + money
  'taint.set': { source: 'string' },
  'budget.threshold': { scope: ['run', 'agent', 'day', 'family', 'tokens'], limit: 'number', spent: 'number', hard: 'boolean' },
  'breaker.trip': { kind: ['repeat', 'failure_streak', 'no_progress', 'unknown_tool'], detail: 'string' },
  'station.halt': { by: ['user', 'system'], reason: 'string?' },
  'undo.saved': { undoId: 'string', path: 'string', op: ['write', 'move', 'delete'] },
  'undo.reverted': { undoId: 'string', path: 'string' },

  // provider health
  'provider.retry': { attempt: 'integer', reason: 'string' },
  'provider.fallback': { from: 'string', to: 'string', reason: 'string' },

  // crew (delegation)
  'crew.dispatch': { workerId: 'string', workerRunId: 'string', task: 'string' },
  'crew.tool_step': { workerId: 'string', workerRunId: 'string', tool: 'string', summary: 'string' },
  'crew.worker_end': { workerId: 'string', workerRunId: 'string', reason: RUN_END_REASONS, usd: 'number' }
};

// Every event carries this envelope.
const ENVELOPE = { v: 'integer', type: 'string', ts: 'number', seq: 'integer', runId: 'string', agentId: 'string' };

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}
export const EVENT_TYPES = deepFreeze(TYPES);
export const EVENT_ENVELOPE = deepFreeze({ ...ENVELOPE });

function kindOk(kind, value) {
  if (Array.isArray(kind)) return typeof value === 'string' && kind.includes(value);
  switch (kind) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array': return Array.isArray(value);
    case 'any': return value !== undefined;
    default: return false;
  }
}

function checkFields(spec, obj, errors, where) {
  for (const [name, raw] of Object.entries(spec)) {
    const optional = typeof raw === 'string' && raw.endsWith('?');
    const kind = optional ? raw.slice(0, -1) : raw;
    if (obj[name] === undefined) { if (!optional) errors.push(`${where}: missing "${name}"`); continue; }
    if (!kindOk(kind, obj[name])) errors.push(`${where}: "${name}" should be ${Array.isArray(kind) ? 'one of ' + kind.join('|') : kind}`);
  }
}

/** Validate an event. Never throws. Returns { ok, errors }. Unknown fields are rejected so drift is caught early. */
export function validateEvent(ev) {
  const errors = [];
  if (ev === null || typeof ev !== 'object' || Array.isArray(ev)) return { ok: false, errors: ['event must be an object'] };
  checkFields(ENVELOPE, ev, errors, 'envelope');
  if (ev.v !== undefined && ev.v !== CONTRACT_VERSION) errors.push(`envelope: unsupported version ${ev.v}`);
  const spec = typeof ev.type === 'string' ? TYPES[ev.type] : undefined;
  if (!spec) { if (typeof ev.type === 'string') errors.push(`unknown event type "${ev.type}"`); return { ok: false, errors }; }
  checkFields(spec, ev, errors, ev.type);
  for (const k of Object.keys(ev)) if (!(k in ENVELOPE) && !(k in spec)) errors.push(`${ev.type}: unknown field "${k}"`);
  return { ok: errors.length === 0, errors };
}

/**
 * Build an event. `ctx` = { runId, agentId, seq, ts }. Returns { ok, event, errors }.
 * Never throws: a malformed event is reported, not emitted, so a bug in one
 * producer can't crash a run or put a lie on the station floor.
 */
export function makeEvent(type, payload, ctx) {
  const event = { v: CONTRACT_VERSION, type, ts: ctx?.ts, seq: ctx?.seq, runId: ctx?.runId, agentId: ctx?.agentId, ...(payload || {}) };
  const { ok, errors } = validateEvent(event);
  return ok ? { ok, event, errors } : { ok, event: null, errors };
}
