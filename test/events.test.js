import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_TYPES, EVENT_ENVELOPE, CONTRACT_VERSION, validateEvent, makeEvent } from '../src/events.js';

const ctx = { runId: 'run_1', agentId: 'smith', seq: 0, ts: 1_700_000_000_000 };

// Snapshot of contract v1. Adding types or OPTIONAL fields is allowed (extend this
// snapshot's new entries in the test below). Anything listed here must keep
// existing with the same kind and the same required-ness.
const V1 = {
  'run.start': { trigger: ['user', 'crew', 'schedule', 'recovery'], provider: 'string', model: 'string', parentRunId: 'string?', task: 'string?' },
  'run.end': { reason: ['done', 'cancelled', 'error', 'max_iters', 'budget', 'halted', 'stale'], usd: 'number', tokens: 'integer', turns: 'integer' },
  'run.error': { message: 'string', code: 'string?' },
  'agent.token': { text: 'string' },
  'agent.reasoning': { text: 'string' },
  'agent.cost': { usd: 'number', priced: 'boolean', inputTokens: 'integer', outputTokens: 'integer', cacheReadTokens: 'integer?', cacheWriteTokens: 'integer?' },
  'agent.waiting': { why: ['permission', 'budget', 'concurrency', 'provider'] },
  'agent.compact': { beforeTokens: 'integer', afterTokens: 'integer' },
  'agent.tool_call': { callId: 'string', tool: 'string', args: 'object' },
  'agent.tool_result': { callId: 'string', tool: 'string', ok: 'boolean', isError: 'boolean', summary: 'string', effectUnknown: 'boolean?' },
  'permission.prompt': { promptId: 'string', callId: 'string', tool: 'string', capability: 'string', scope: ['read', 'write', 'execute'], summary: 'string', outsideWorkspace: 'boolean' },
  'permission.response': { promptId: 'string', decision: ['allow_once', 'allow_session', 'allow_always', 'deny'], by: ['user', 'rule', 'hardline', 'autonomous'] },
  'taint.set': { source: 'string' },
  'budget.threshold': { scope: ['run', 'agent', 'day', 'family', 'tokens'], limit: 'number', spent: 'number', hard: 'boolean' },
  'breaker.trip': { kind: ['repeat', 'failure_streak', 'no_progress', 'unknown_tool'], detail: 'string' },
  'station.halt': { by: ['user', 'system'], reason: 'string?' },
  'undo.saved': { undoId: 'string', path: 'string', op: ['write', 'move', 'delete'] },
  'undo.reverted': { undoId: 'string', path: 'string' },
  'provider.retry': { attempt: 'integer', reason: 'string' },
  'provider.fallback': { from: 'string', to: 'string', reason: 'string' },
  'crew.dispatch': { workerId: 'string', workerRunId: 'string', task: 'string' },
  'crew.tool_step': { workerId: 'string', workerRunId: 'string', tool: 'string', summary: 'string' },
  'crew.worker_end': { workerId: 'string', workerRunId: 'string', reason: ['done', 'cancelled', 'error', 'max_iters', 'budget', 'halted', 'stale'], usd: 'number' }
};

test('contract is additive-only relative to the v1 snapshot', () => {
  assert.equal(CONTRACT_VERSION, 1);
  for (const [type, fields] of Object.entries(V1)) {
    const now = EVENT_TYPES[type];
    assert.ok(now, `type "${type}" was removed`);
    for (const [name, kind] of Object.entries(fields)) {
      const cur = now[name];
      assert.ok(cur !== undefined, `${type}.${name} was removed`);
      if (Array.isArray(kind)) {
        assert.ok(Array.isArray(cur), `${type}.${name} changed kind`);
        for (const v of kind) assert.ok(cur.includes(v), `${type}.${name} lost enum value "${v}"`);
      } else {
        assert.equal(cur, kind, `${type}.${name} changed kind or required-ness`);
      }
    }
    for (const [name, kind] of Object.entries(now)) {
      if (!(name in fields)) assert.ok(typeof kind === 'string' && kind.endsWith('?'), `new field ${type}.${name} must be optional`);
    }
  }
  assert.deepEqual(Object.keys(EVENT_ENVELOPE), ['v', 'type', 'ts', 'seq', 'runId', 'agentId']);
});

test('contract objects are frozen', () => {
  assert.ok(Object.isFrozen(EVENT_TYPES));
  assert.ok(Object.isFrozen(EVENT_TYPES['run.end']));
  assert.ok(Object.isFrozen(EVENT_TYPES['run.end'].reason));
  assert.throws(() => { 'use strict'; EVENT_TYPES['run.end'].usd = 'string'; });
});

test('makeEvent builds a valid event with the envelope', () => {
  const r = makeEvent('agent.tool_call', { callId: 'c1', tool: 'shell.exec', args: { cmd: 'ls' } }, ctx);
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.deepEqual(r.event, { v: 1, type: 'agent.tool_call', ...ctx, callId: 'c1', tool: 'shell.exec', args: { cmd: 'ls' } });
});

test('optional fields may be omitted or present', () => {
  assert.ok(makeEvent('run.start', { trigger: 'user', provider: 'claude-code', model: 'claude-opus-5-5' }, ctx).ok);
  assert.ok(makeEvent('run.start', { trigger: 'crew', provider: 'claude-code', model: 'claude-opus-5-5', parentRunId: 'run_0', task: 'ls' }, ctx).ok);
});

test('rejects missing, mistyped, unknown and out-of-enum fields without throwing', () => {
  const cases = [
    ['run.end', { reason: 'done', usd: 0, tokens: 10 }, /missing "turns"/],
    ['run.end', { reason: 'finished', usd: 0, tokens: 10, turns: 1 }, /"reason" should be one of/],
    ['run.end', { reason: 'done', usd: NaN, tokens: 10, turns: 1 }, /"usd" should be number/],
    ['run.end', { reason: 'done', usd: 0, tokens: 1.5, turns: 1 }, /"tokens" should be integer/],
    ['agent.token', { text: 'hi', extra: 1 }, /unknown field "extra"/],
    ['agent.tool_call', { callId: 'c', tool: 't', args: [] }, /"args" should be object/],
    ['nope.type', {}, /unknown event type/]
  ];
  for (const [type, payload, re] of cases) {
    const r = makeEvent(type, payload, ctx);
    assert.equal(r.ok, false, `${type} should fail`);
    assert.equal(r.event, null);
    assert.match(r.errors.join('; '), re);
  }
});

test('envelope is required and payload cannot override it badly', () => {
  assert.match(makeEvent('agent.token', { text: 'x' }, { ...ctx, runId: undefined }).errors.join(), /missing "runId"/);
  assert.match(makeEvent('agent.token', { text: 'x', v: 2 }, ctx).errors.join(), /unsupported version 2/);
  for (const bad of [null, 'str', [], 42]) assert.equal(validateEvent(bad).ok, false);
});

test('every event type has at least one field and valid kind specs', () => {
  const kinds = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'any']);
  for (const [type, spec] of Object.entries(EVENT_TYPES)) {
    assert.match(type, /^[a-z]+\.[a-z_]+$/);
    assert.ok(Object.keys(spec).length > 0, type);
    for (const [name, k] of Object.entries(spec)) {
      assert.ok(!(name in EVENT_ENVELOPE), `${type}.${name} shadows the envelope`);
      if (Array.isArray(k)) assert.ok(k.length > 0 && k.every(v => typeof v === 'string'));
      else assert.ok(kinds.has(k.replace(/\?$/, '')), `${type}.${name}: bad kind ${k}`);
    }
  }
});
