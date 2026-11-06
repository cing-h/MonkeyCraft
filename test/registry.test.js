import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRegistry, validateArgs } from '../src/tools/registry.js';

const schema = { type: 'object', properties: { path: { type: 'string', maxLength: 10 }, n: { type: 'integer', minimum: 1 } }, required: ['path'], additionalProperties: false };

function setup(tools, { allow = true, grants } = {}) {
  const events = []; let n = 0; const asked = [];
  const ctx = {
    emit: (type, p) => events.push({ type, ...p }), newId: p => `${p}_${++n}`,
    grants: grants || new Set(tools.map(t => t.name)), interactive: true, runId: 'r1',
    consent: { request: async r => { asked.push(r); return allow; } }
  };
  return { reg: makeRegistry(tools), ctx, events, asked };
}
const readTool = (run = async () => ({ content: 'hello', summary: 'read' })) => ({ name: 'fs.read', scope: 'read', capability: 'files', inputSchema: schema, run });
const execTool = (extra = {}) => ({ name: 'shell.exec', scope: 'execute', capability: 'shell', inputSchema: schema, assess: async a => ({ summary: `$ ${a.path}`, cacheKey: a.path }), run: async () => ({ content: 'ran' }), ...extra });

test('validateArgs subset', () => {
  assert.deepEqual(validateArgs(schema, { path: 'a' }), []);
  assert.match(validateArgs(schema, {}).join(), /missing "path"/);
  assert.match(validateArgs(schema, { path: 'a', x: 1 }).join(), /unknown argument "x"/);
  assert.match(validateArgs(schema, { path: 'a', n: 1.5 }).join(), /"n" should be integer/);
  assert.match(validateArgs(schema, { path: 'a'.repeat(11) }).join(), /longer than 10/);
  assert.match(validateArgs(schema, { path: 'a', n: 0 }).join(), /below 1/);
  assert.match(validateArgs(schema, []).join(), /must be an object/);
});

test('a read runs without consent and emits paired call/result events', async () => {
  const { reg, ctx, events, asked } = setup([readTool()]);
  const r = await reg.dispatch({ tool: 'fs_read', args: { path: 'a' } }, ctx);
  assert.equal(r.ok, true); assert.equal(r.content, 'hello');
  assert.equal(asked.length, 0);
  assert.deepEqual(events.map(e => e.type), ['agent.tool_call', 'agent.tool_result']);
  assert.equal(events[0].callId, events[1].callId);
  assert.equal(events[0].tool, 'fs.read');
});

test('pipeline order: unknown, not granted, bad args, blocked, denied — nothing runs', async () => {
  let ran = 0; const t = execTool({ run: async () => { ran++; return { content: 'x' }; } });
  let s = setup([t]);
  assert.match((await s.reg.dispatch({ tool: 'nope', args: {} }, s.ctx)).content, /no tool called/);
  s = setup([t], { grants: new Set() });
  assert.match((await s.reg.dispatch({ tool: 'shell.exec', args: { path: 'a' } }, s.ctx)).content, /don't have/);
  s = setup([t]);
  assert.match((await s.reg.dispatch({ tool: 'shell.exec', args: { nope: 1 } }, s.ctx)).content, /Invalid arguments/);
  assert.match((await s.reg.dispatch({ tool: 'shell.exec', args: 'ls' }, s.ctx)).content, /must be a JSON object/);
  assert.match((await s.reg.dispatch({ tool: 'shell.exec', args: { path: 'a' }, parseError: 'cut off' }, s.ctx)).content, /weren't valid JSON/);
  s = setup([{ ...t, assess: async () => ({ deny: 'protected location /etc' }) }]);
  assert.match((await s.reg.dispatch({ tool: 'shell.exec', args: { path: 'a' } }, s.ctx)).content, /Blocked by an MonkeyCraft safety rule/);
  assert.equal(s.asked.length, 0, 'hardline is decided before any prompt');
  s = setup([t], { allow: false });
  const r = await s.reg.dispatch({ tool: 'shell.exec', args: { path: 'a' } }, s.ctx);
  assert.match(r.content, /said no/); assert.equal(r.isError, true);
  assert.equal(s.asked[0].summary, '$ a'); assert.equal(s.asked[0].cacheKey, 'a');
  assert.equal(ran, 0);
  for (const e of s.events) if (e.type === 'agent.tool_result') assert.equal(e.ok, false);
});

test('approved execute runs once; a throwing tool and a timeout become error results', async () => {
  let ran = 0;
  let s = setup([execTool({ run: async () => { ran++; return { content: 'ok' }; } })]);
  assert.equal((await s.reg.dispatch({ tool: 'shell.exec', args: { path: 'a' } }, s.ctx)).ok, true);
  assert.equal(ran, 1);
  s = setup([readTool(async () => { throw new Error('disk on fire'); })]);
  const r = await s.reg.dispatch({ tool: 'fs.read', args: { path: 'a' } }, s.ctx);
  assert.equal(r.isError, true); assert.match(r.content, /disk on fire/);
  s = setup([{ ...readTool((a, c) => new Promise(res => c.signal.addEventListener('abort', () => res({ content: 'aborted' })))), timeoutMs: 30 }]);
  const t = await s.reg.dispatch({ tool: 'fs.read', args: { path: 'a' } }, s.ctx);
  assert.equal(t.isError, true); assert.match(t.content, /timed out/);
});

test('an aborted job runs nothing', async () => {
  const s = setup([readTool()]); const ac = new AbortController(); ac.abort('halt');
  const r = await s.reg.dispatch({ tool: 'fs.read', args: { path: 'a' } }, { ...s.ctx, signal: ac.signal });
  assert.match(r.content, /stopped/);
});
