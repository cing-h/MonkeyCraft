// What each creature is doing, derived ONLY from the event stream.
// This is the truthful-station rule in code: the floor may show a creature
// working, asking or talking only when events say so. Pure: no DOM, no clock
// (event timestamps drive every timer, so replayed history never animates).

export const HOLD_MS = 1200;   // keep a finished tool's work pose visible this long, so a 10 ms command can still be seen
export const TALK_MS = 1500;   // "talking" lasts this long after the last streamed word
export const ERROR_MS = 6000;  // the "!" plate stays this long after a failure

export function initialState(crew) {
  const creatures = {};
  for (const c of crew) creatures[c.id] = { id: c.id, name: c.name, awake: !!c.awake, runId: null, active: false, tools: [], asks: [], toolEndAt: -Infinity, talkAt: -Infinity, errorAt: -Infinity, errorText: '' };
  return { creatures, last: -Infinity, councils: new Set() };   // councils: the runIds of council jobs (source 'council')
}

/** Apply one event. Unknown agents and unknown types change nothing. Returns the same state object. */
export function reduce(state, ev) {
  const c = ev && state.creatures[ev.agentId];
  if (!c || !c.awake) return state;
  if (ev.type === 'run.start' && ev.source === 'council') (state.councils ||= new Set()).add(ev.runId);
  if (Number.isFinite(ev.ts)) state.last = Math.max(state.last, ev.ts);
  switch (ev.type) {
    case 'run.start': c.runId = ev.runId; c.active = true; c.tools = []; c.asks = []; c.council = ev.source === 'council' || !!state.councils?.has(ev.parentRunId); break;
    case 'agent.tool_call': if (c.active) c.tools.push(ev.callId); break;
    case 'agent.tool_result': c.tools = c.tools.filter(id => id !== ev.callId); c.toolEndAt = ev.ts; break;
    case 'permission.prompt': if (c.active) c.asks.push({ promptId: ev.promptId, summary: ev.summary, scope: ev.scope, outsideWorkspace: ev.outsideWorkspace, runId: ev.runId }); break;
    case 'permission.response': c.asks = c.asks.filter(a => a.promptId !== ev.promptId); break;
    case 'agent.token': if (c.active) c.talkAt = ev.ts; break;
    case 'run.error': c.errorAt = ev.ts; c.errorText = ev.message; break;
    case 'run.end':
      if (ev.runId !== c.runId) break;
      c.active = false; c.tools = []; c.asks = []; c.talkAt = -Infinity; c.council = false;
      if (ev.reason !== 'done' && ev.reason !== 'cancelled') { c.errorAt = ev.ts; c.errorText ||= `Job ended: ${ev.reason}`; }
      break;
  }
  return state;
}

/**
 * The one mode the floor shows for a creature at time `now` (ms, same clock as event ts).
 * Priority: asleep > asking > working > error > talking > ready > idle.
 *   asleep  – not part of this edition yet: sleeps at its station, "Z" plate
 *   asking  – waiting for the user's permission: stands at station, "?" plate
 *   working – a tool is running (or just finished, within HOLD_MS): work pose + lights
 *   error   – a job failed recently: "!" plate
 *   talking – streaming words: "…" plate
 *   ready   – has a job, between steps: stands at its station
 *   idle    – no job: wanders the floor
 */
export function modeOf(c, now) {
  if (!c.awake) return 'asleep';
  if (c.asks.length) return 'asking';
  if (c.tools.length || now - c.toolEndAt < HOLD_MS) return 'working';
  if (now - c.errorAt < ERROR_MS) return 'error';
  if (c.active && now - c.talkAt < TALK_MS) return 'talking';
  if (c.active) return 'ready';
  return 'idle';
}

/** Is this creature at a council right now (the council job, or speaking at one)? The village sends it to the Ring. */
export const inCouncil = c => !!(c && c.active && c.council);

export const MODE_TEXT = { asleep: 'Asleep', asking: 'Needs your OK', working: 'Working', error: 'Something went wrong', talking: 'Thinking out loud', ready: 'On a job', idle: 'Free' };
