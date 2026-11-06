import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce, modeOf, HOLD_MS, TALK_MS, ERROR_MS } from '../ui/station/state.js';
import { makeStation, CREW_IDS } from '../ui/station/scene.js';

const crew = [{ id: 'smith', name: 'Cinder Smith', awake: true }, { id: 'seer', name: 'Tide Seer', awake: false }];
let seq = 0;
const ev = (type, ts, extra = {}) => ({ v: 1, type, ts, seq: seq++, runId: extra.runId || 'r1', agentId: extra.agentId || 'smith', ...extra });

test('scripted feed: every mode comes from an event, in order', () => {
  const s = initialState(crew), c = s.creatures.smith, at = t => modeOf(c, t);
  assert.equal(at(0), 'idle');
  reduce(s, ev('run.start', 1000, { trigger: 'user', provider: 'claude-code', model: 'm' }));
  assert.equal(at(1000), 'ready');
  reduce(s, ev('agent.token', 1100, { text: 'Let me look' }));
  assert.equal(at(1100), 'talking');
  assert.equal(at(1100 + TALK_MS), 'ready', 'talking fades without new words');
  reduce(s, ev('agent.tool_call', 2000, { callId: 'c1', tool: 'shell.exec', args: {} }));
  assert.equal(at(2000), 'working');
  reduce(s, ev('permission.prompt', 2001, { promptId: 'p1', callId: 'c1', tool: 'shell.exec', capability: 'shell', scope: 'execute', summary: '$ ls', outsideWorkspace: false }));
  assert.equal(at(2001), 'asking', 'asking outranks working');
  assert.equal(c.asks[0].summary, '$ ls');
  assert.equal(at(60_000), 'asking', 'an unanswered question stays up');
  reduce(s, ev('permission.response', 5000, { promptId: 'p1', decision: 'allow_once', by: 'user' }));
  assert.equal(at(5000), 'working');
  reduce(s, ev('agent.tool_result', 5010, { callId: 'c1', tool: 'shell.exec', ok: true, isError: false, summary: 'exit code 0' }));
  assert.equal(at(5010 + HOLD_MS - 1), 'working', 'a 10 ms command stays visible briefly');
  assert.equal(at(5010 + HOLD_MS), 'ready');
  reduce(s, ev('run.end', 7000, { reason: 'done', usd: 0, tokens: 1, turns: 1 }));
  assert.equal(at(7000), 'idle');
});

test('failures show "!" for a while; a cancelled job does not', () => {
  const s = initialState(crew), c = s.creatures.smith;
  reduce(s, ev('run.start', 0, { runId: 'r2' }));
  reduce(s, ev('run.error', 100, { runId: 'r2', message: 'boom' }));
  reduce(s, ev('run.end', 200, { runId: 'r2', reason: 'error', usd: 0, tokens: 0, turns: 0 }));
  assert.equal(modeOf(c, 300), 'error'); assert.equal(c.errorText, 'boom');
  assert.equal(modeOf(c, 200 + ERROR_MS), 'idle');
  reduce(s, ev('run.start', 20_000, { runId: 'r3' }));
  reduce(s, ev('run.end', 20_100, { runId: 'r3', reason: 'cancelled', usd: 0, tokens: 0, turns: 0 }));
  assert.equal(modeOf(c, 20_200), 'idle');
});

test('nothing animates without a matching event', () => {
  const s = initialState(crew), c = s.creatures.smith;
  // events before a run, for other agents, for sleeping crew, and unknown types change nothing
  reduce(s, ev('agent.tool_call', 10, { callId: 'x', tool: 't', args: {} }));
  reduce(s, ev('agent.token', 10, { text: 'hi' }));
  reduce(s, ev('permission.prompt', 10, { promptId: 'p', callId: 'x', tool: 't', capability: 'c', scope: 'execute', summary: 's', outsideWorkspace: false }));
  reduce(s, ev('run.start', 10, { agentId: 'seer' }));
  reduce(s, ev('run.start', 10, { agentId: 'ghost' }));
  reduce(s, ev('made.up', 10));
  reduce(s, null);
  assert.equal(modeOf(c, 10), 'idle');
  assert.equal(modeOf(s.creatures.seer, 10), 'asleep');
  assert.deepEqual([c.tools, c.asks], [[], []]);
  // a stale run.end for another run doesn't end the current one
  reduce(s, ev('run.start', 20, { runId: 'r5' }));
  reduce(s, ev('run.end', 21, { runId: 'r4', reason: 'done', usd: 0, tokens: 0, turns: 0 }));
  assert.equal(modeOf(c, 22), 'ready');
});

test('replayed history (old timestamps) does not animate now', () => {
  const s = initialState(crew), c = s.creatures.smith;
  reduce(s, ev('run.start', 0, { runId: 'old' }));
  reduce(s, ev('agent.tool_call', 1, { runId: 'old', callId: 'c', tool: 't', args: {} }));
  reduce(s, ev('agent.tool_result', 2, { runId: 'old', callId: 'c', tool: 't', ok: true, isError: false, summary: 'ok' }));
  reduce(s, ev('run.end', 3, { runId: 'old', reason: 'done', usd: 0, tokens: 0, turns: 0 }));
  assert.equal(modeOf(c, 1_000_000), 'idle');
});

// ---------- the scene draws from modes (headless canvas) ----------
function fakeCanvas() {
  const ops = [];
  const ctx = { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData(img) { this.last = img; }, fillRect: (...a) => ops.push(a), set fillStyle(v) { ops.push(['style', v]); } };
  return { width: 0, height: 0, getContext: () => ctx, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1080, height: 720 }), ctx, ops };
}

test('scene: glow appears only while the mode says working, and plates match modes', () => {
  const modes = Object.fromEntries(CREW_IDS.map(k => [k, 'asleep'])); modes.smith = 'idle';
  const cv = fakeCanvas();
  const st = makeStation(cv, { modeOf: id => modes[id] });
  const litPixels = () => st._view.em.reduce((n, v) => n + v, 0); // pixels lit by a WORKING creature's lights
  const home = st.anchor('smith');
  for (let i = 0; i < 100; i++) st.step(0); // idle: it wanders off
  assert.notDeepEqual(st.anchor('smith'), home, 'idle smith wandered away');
  assert.equal(litPixels(), 0, 'no working lights while everyone is idle or asleep');
  modes.smith = 'working';
  st.step(0);
  assert.equal(litPixels(), 0, 'not lit while still walking to the forge');
  for (let i = 0; i < 60; i++) st.step(0); // walk to the forge, then hammer
  assert.ok(litPixels() > 10, `working at the forge lights up (${litPixels()} px)`);
  modes.smith = 'ready'; st.step(0);
  assert.equal(st._actors.smith.inside, false, 'the smith comes out as soon as the mode leaves working');
  for (let i = 0; i < 20; i++) st.step(0); // the last embers from the chimney fade out
  assert.equal(litPixels(), 0, 'no working lights once the job step is over');
  // asking draws a yellow "?" plate; asleep crew draw "Z" plates
  cv.ops.length = 0; modes.smith = 'asking'; st.step(0);
  const styles = cv.ops.filter(o => o[0] === 'style').map(o => o[1]);
  assert.ok(styles.includes('#f2c531'), 'yellow ? plate'); assert.ok(styles.includes('#8fb4ff'), 'Z plates for sleepers');
  // the smith is at its station and can be picked there
  const [x, y] = st.anchor('smith');
  assert.ok(x > 0 && y > 0);
});
