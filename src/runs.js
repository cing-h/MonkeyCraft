// The run host: the one place a job starts. Every surface (chat now, crew
// delegation and schedules later) calls start(), which binds a creature, a
// provider, its tool grants and a secret MCP token to one runId, and always
// finishes with run.end plus a ledger row.
//
// Each run carries its own safety state: a web-read lockout (taint), a loop
// breaker and a token budget, and a stop(reason) that ends it as 'budget' or
// 'stale'. The soft daily limit is checked before a job starts.

import { makeTaint } from './safety/taint.js';
import { makeBreaker } from './safety/breaker.js';
import { makeRunBudget, dailyStatus } from './money/budget.js';

export function makeRunHost({ bus, providers, registry, consent, ledger, roster, journal, clock, newId, newToken, mcpUrl, limits, undo, guardPath = async () => null }) {
  const active = new Map(); // runId -> { agentId, token, controller, emit, grants, interactive, taint, breaker, budget, stop }
  const dayStart = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const today = { day: -1, usd: 0 };
  const todayUsd = () => { const d = dayStart(clock.now()); if (d !== today.day) { today.day = d; today.usd = 0; } return today.usd; };
  const daily = () => dailyStatus(todayUsd(), limits.dailyUsd ?? Infinity);

  async function execute(run, agent, prompt) {
    const { runId, emit, controller } = run;
    const provider = providers[agent.provider];
    emit('run.start', { trigger: 'user', provider: agent.provider, model: agent.model, task: prompt.slice(0, 500) });
    const day = daily();
    if (day.near) emit('budget.threshold', { scope: 'day', limit: day.limit, spent: day.spent, hard: false });
    let res;
    try {
      res = await provider.run({
        agent, prompt, signal: controller.signal, emit, maxBudgetUsd: limits.perRunUsd, onUsage: u => run.budget.usage(u),
        mcpConfig: { mcpServers: { monkeycraft: { type: 'http', url: mcpUrl(runId), headers: { Authorization: `Bearer ${run.token}` } } } }
      });
    } catch (e) {
      emit('run.error', { message: `Provider failed: ${e.message}`, code: 'provider_threw' });
      res = { reason: 'error', usd: 0, tokens: 0, turns: 0, billing: 'unknown' };
    }
    active.delete(runId);
    if (res.reason === 'budget' && !run.budget.tripped) emit('budget.threshold', { scope: 'run', limit: limits.perRunUsd, spent: res.usd, hard: true });
    todayUsd(); today.usd += Number.isFinite(res.usd) ? res.usd : 0;
    emit('run.end', { reason: res.reason, usd: res.usd, tokens: res.tokens, turns: res.turns });
    try {
      await ledger.append({ runId, agentId: agent.id, provider: agent.provider, billing: res.billing, usd: res.usd, tokens: res.tokens, turns: res.turns, reason: res.reason, settled: true, ts: clock.now() });
    } catch (e) { console.error('[ledger] write failed:', e.message); }
    return res;
  }

  return {
    /** Start a job. Returns { runId, done } or { error }. */
    /** Load today's spend from the ledger, for the daily limit. */
    async init() { const t = await ledger.totals(dayStart(clock.now())); todayUsd(); today.usd = t.usd; },

    /** Today's spend against the soft daily limit. */
    daily,

    start({ agentId, prompt, interactive = true, allowOverDaily = false }) {
      const agent = roster.get(agentId);
      if (!agent) return { error: `No crew member "${agentId}".` };
      if (!agent.awake) return { error: `${agent.name} is asleep until ${agent.wakes}.` };
      if (typeof prompt !== 'string' || !prompt.trim()) return { error: 'Empty job.' };
      if (prompt.length > 20_000) return { error: 'That job description is too long (20,000 characters max).' };
      if (!providers[agent.provider]) return { error: `Provider "${agent.provider}" is not available.` };
      if (active.size >= limits.maxConcurrent) return { error: 'The crew is busy. Wait for the current job to finish or press STOP.' };
      const day = daily();
      if (day.over && !allowOverDaily) return { error: `Today's spending (~$${day.spent.toFixed(2)}) has reached the daily limit of $${day.limit}.`, code: 'daily_cap' };
      const runId = newId('run');
      const controller = new AbortController(), emit = bus.emitFor(runId, agentId);
      const stop = reason => { if (!controller.signal.aborted) controller.abort(reason); };
      const run = {
        runId, agentId, token: newToken(), controller, emit, grants: agent.grantSet, interactive, stop,
        taint: makeTaint(), breaker: makeBreaker(), budget: makeRunBudget({ perRunTokens: limits.perRunTokens ?? Infinity, emit, stop })
      };
      active.set(runId, run);
      return { runId, done: execute(run, agent, prompt.trim()) };
    },

    /** Context for an MCP request, or null if the run/token doesn't match. */
    mcpContext(runId, token) {
      const run = active.get(runId);
      if (!run || !token || token.length !== run.token.length || !timingSafeEq(token, run.token)) return null;
      return {
        listTools: () => registry.list(run.grants).map(t => ({ name: t.name.replace(/\./g, '_'), description: t.description, inputSchema: t.inputSchema })),
        callTool: (name, args) => registry.dispatch({ tool: name, args }, {
          emit: run.emit, newId, grants: run.grants, consent, interactive: run.interactive, signal: run.controller.signal, runId, agentId: run.agentId,
          taint: run.taint, breaker: run.breaker, stop: run.stop
        })
      };
    },

    /** Mark a running job as having read untrusted content (e.g. a provider's own web search). */
    taintRun(runId, source) { const r = active.get(runId); if (r && r.taint.set(source)) r.emit('taint.set', { source }); return !!r; },

    /** "Revert this job": undo its file changes, newest first. */
    async revert(runId) {
      if (active.has(runId)) return { error: 'This job is still running. Wait for it to finish or stop it first.' };
      if (!undo) return { error: 'Undo is not available.' };
      const evs = await journal.read(runId);
      if (!evs.length) return { error: 'No such job.' };
      const results = await undo.revert(runId, { guard: guardPath });
      const emit = bus.emitFor(runId, evs[0].agentId, Math.max(...evs.map(e => e.seq)) + 1);
      for (const r of results) if (r.result === 'restored' || r.result === 'removed') emit('undo.reverted', { undoId: r.undoId, path: r.path });
      await journal.flush();
      return { results };
    },

    cancel(runId) { const r = active.get(runId); if (!r) return false; r.controller.abort('cancel'); return true; },

    /** STOP: abort every run. */
    halt(by = 'user') {
      const n = active.size;
      for (const r of active.values()) { r.emit('station.halt', { by }); r.controller.abort('halt'); }
      return n;
    },

    active: () => [...active.values()].map(r => ({ runId: r.runId, agentId: r.agentId })),

    /** After a crash: close runs that never ended, and record them as unsettled. */
    async recover() {
      const out = [];
      for (const u of await journal.unfinished()) {
        const emit = bus.emitFor(u.runId, u.agentId, u.lastSeq + 1);
        emit('run.error', { message: 'MonkeyCraft stopped while this job was running. Its spend is unknown, and any command it started may or may not have finished.', code: 'interrupted' });
        emit('run.end', { reason: 'error', usd: 0, tokens: 0, turns: 0 });
        await ledger.append({ runId: u.runId, agentId: u.agentId, provider: u.provider, billing: 'unknown', usd: 0, tokens: 0, turns: 0, reason: 'interrupted', settled: false, ts: clock.now() });
        out.push(u.runId);
      }
      return out;
    }
  };
}

function timingSafeEq(a, b) {
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
