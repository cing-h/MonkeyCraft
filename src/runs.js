// The run host: the one place a job starts. Every surface (chat now, crew
// delegation, schedules later) goes through startRun(), which binds a creature,
// a provider, its tool grants and a secret MCP token to one runId, and always
// finishes with run.end plus a ledger row.
//
// Each run carries its own safety state: a web-read lockout (taint), a loop
// breaker, a token budget and a stop(reason) that ends it as 'budget' or
// 'stale'. The soft daily limit is checked before a top-level job starts.
//
// Crew (M4): the Chief's delegation tools start WORKER runs with a parent.
// - A worker gets only its own tool grants. The web-read lockout stays on the
//   job that read the web (the user's choice); the lead is told when a report
//   came from such a job.
// - A lead and its workers form a family that shares one spending pool. If
//   the pool runs out, every member stops.
// - At most `maxWorkers` workers run at once, and each crew member does one
//   job at a time.
// - Stopping or cancelling the lead stops its workers.
// - A worker with no progress for 450 s (1,200 s while a tool is running) is
//   stopped as 'stale' (see checkLiveness).

import { makeTaint } from './safety/taint.js';
import { makeBreaker } from './safety/breaker.js';
import { makeRunBudget, dailyStatus, weighTokens } from './money/budget.js';

const WORKER_PREAMBLE = `The Chief has given you this task as part of a larger job for the user. You can't ask the Chief questions: if something is unclear, make a sensible choice and say what you assumed. When you finish, reply with a short report of what you did and found; that report is all the Chief will see.\n\nTask:\n`;
const MAX_REPORT = 8000;
const LIVENESS = { idleMs: 450_000, toolMs: 1_200_000 };

export function makeRunHost({ bus, providers, registry, consent, ledger, roster, journal, clock, newId, newToken, mcpUrl, limits, undo, guardPath = async () => null, remoteUndo = null, onRunEnd = () => {} }) {
  const active = new Map(); // runId -> run
  const dayStart = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const today = { day: -1, usd: 0 };
  const todayUsd = () => { const d = dayStart(clock.now()); if (d !== today.day) { today.day = d; today.usd = 0; } return today.usd; };
  const daily = () => dailyStatus(todayUsd(), limits.dailyUsd ?? Infinity);
  const busy = agentId => [...active.values()].some(r => r.agentId === agentId);
  const workerCount = () => [...active.values()].filter(r => r.parent).length;

  // ---------- the family spending pool (a lead and its workers) ----------
  function makeFamily(lead) {
    return {
      lead, members: new Map(), usd: 0, warned: false, tripped: false,
      limitTokens: limits.familyTokens ?? Infinity, limitUsd: limits.familyUsd ?? Infinity,
      usage(runId, tokens) {
        this.members.set(runId, tokens);
        const spent = [...this.members.values()].reduce((a, b) => a + b, 0);
        if (this.members.size < 2) return;                       // a lone job is covered by its own limit
        if (!this.warned && spent >= 0.8 * this.limitTokens) { this.warned = true; lead.emit('budget.threshold', { scope: 'family', limit: this.limitTokens, spent, hard: false }); }
        if (!this.tripped && spent >= this.limitTokens) {
          this.tripped = true; lead.emit('budget.threshold', { scope: 'family', limit: this.limitTokens, spent, hard: true });
          for (const r of active.values()) if (r.family === this) r.stop('budget');
        }
      }
    };
  }

  async function execute(run, agent, prompt) {
    const { runId, emit, controller } = run;
    const provider = providers[agent.provider];
    emit('run.start', { trigger: run.parent ? 'crew' : (run.trigger || 'user'), provider: agent.provider, model: agent.model, task: prompt.slice(0, 500), ...(run.parent ? { parentRunId: run.parent.runId } : {}), ...(run.source ? { source: run.source } : {}) });
    if (!run.parent) { const day = daily(); if (day.near) emit('budget.threshold', { scope: 'day', limit: day.limit, spent: day.spent, hard: false }); }
    const left = run.family.limitUsd - run.family.usd;
    let res;
    try {
      res = await provider.run({
        agent, prompt: run.parent ? (run.preamble ?? WORKER_PREAMBLE) + prompt : prompt, signal: controller.signal, emit,
        maxBudgetUsd: Math.max(0.05, Math.min(limits.perRunUsd, left)),
        onUsage: u => { run.budget.usage(u); run.family.usage(runId, weighTokens(u)); },
        onTaint: source => { if (run.taint.set(source)) emit('taint.set', { source }); },
        mcpConfig: { mcpServers: { monkeycraft: { type: 'http', url: mcpUrl(runId), headers: { Authorization: `Bearer ${run.token}` } } } },
        tools: localTools(run)   // the API provider calls the same pipeline directly
      });
    } catch (e) {
      emit('run.error', { message: `Provider failed: ${e.message}`, code: 'provider_threw' });
      res = { reason: 'error', usd: 0, tokens: 0, turns: 0, billing: 'unknown', text: '' };
    }
    active.delete(runId);
    run.unlink?.();
    if (res.reason === 'budget' && !run.budget.tripped && !run.family.tripped) emit('budget.threshold', { scope: 'run', limit: limits.perRunUsd, spent: res.usd, hard: true });
    const usd = Number.isFinite(res.usd) ? res.usd : 0;
    todayUsd(); today.usd += usd; run.family.usd += usd;
    emit('run.end', { reason: res.reason, usd: res.usd, tokens: res.tokens, turns: res.turns });
    try { onRunEnd(runId); } catch (e) { console.error('[runs] onRunEnd failed:', e.message); }
    if (run.parent) run.parent.emit('crew.worker_end', { workerId: agent.id, workerRunId: runId, reason: res.reason, usd });
    try {
      await ledger.append({ runId, agentId: agent.id, provider: agent.provider, billing: res.billing, usd: res.usd, tokens: res.tokens, turns: res.turns, reason: res.reason, settled: true, ts: clock.now() });
    } catch (e) { console.error('[ledger] write failed:', e.message); }
    return { ...res, tainted: run.taint.tainted };
  }

  // agentOverride: run this crew member in a different shape (the council: no tools, its own instructions and model).
  // preamble: what a worker is told before its task. trigger: 'user' or 'schedule'. poolUsd: a smaller spending pool.
  function startRun({ agentId, prompt, interactive = true, allowOverDaily = false, parent = null, source = null, agentOverride = null, preamble = null, trigger = null, poolUsd = null }) {
    const agent = agentOverride && agentOverride.id === agentId ? agentOverride : roster.get(agentId);
    if (!agent) return { error: `No crew member "${agentId}".` };
    if (!agent.awake) return { error: `${agent.name} is asleep until ${agent.wakes}.` };
    if (typeof prompt !== 'string' || !prompt.trim()) return { error: 'Empty job.' };
    if (prompt.length > 20_000) return { error: 'That job description is too long (20,000 characters max).' };
    if (!providers[agent.provider]) return { error: `Provider "${agent.provider}" is not available.` };
    if (busy(agentId)) return { error: `${agent.name} is already busy with another job.${parent ? ' Wait for it (crew.wait) or give the task to someone else.' : ' Wait for it to finish or press STOP.'}` };
    if (parent) {
      if (workerCount() >= (limits.maxWorkers ?? 2)) return { error: `${limits.maxWorkers ?? 2} crew members are already working. Wait for one to finish (crew.wait) before starting another.` };
      if (parent.family.tripped || parent.family.usd >= parent.family.limitUsd) return { error: 'This job has used up its spending pool, so no more crew can be sent.' };
    } else {
      if ([...active.values()].filter(r => !r.parent).length >= limits.maxConcurrent) return { error: 'The crew is busy. Wait for the current job to finish or press STOP.' };
      const day = daily();
      if (day.over && !allowOverDaily) return { error: `Today's spending (~$${day.spent.toFixed(2)}) has reached the daily limit of $${day.limit}.`, code: 'daily_cap' };
    }
    const runId = newId('run');
    const controller = new AbortController(), raw = bus.emitFor(runId, agentId);
    const stop = reason => { if (!controller.signal.aborted) controller.abort(reason); };
    const run = {
      runId, agentId, agent, token: newToken(), controller, grants: agent.grantSet, interactive, stop, parent, source: parent ? null : source, preamble, trigger: parent ? null : trigger,
      taint: makeTaint(), breaker: makeBreaker(), workers: new Map(),
      lastProgress: clock.now(), toolsRunning: 0
    };
    // every event counts as progress; open tool calls lengthen the allowed quiet time
    run.emit = (type, payload) => {
      run.lastProgress = clock.now();
      if (type === 'agent.tool_call') run.toolsRunning++;
      else if (type === 'agent.tool_result') run.toolsRunning = Math.max(0, run.toolsRunning - 1);
      return raw(type, payload);
    };
    run.budget = makeRunBudget({ perRunTokens: limits.perRunTokens ?? Infinity, emit: run.emit, stop });
    run.family = parent ? parent.family : makeFamily(run);
    if (!parent && poolUsd != null) run.family.limitUsd = Math.min(run.family.limitUsd, poolUsd);
    if (parent) {   // stopping or cancelling the lead stops its workers
      const onAbort = () => { const why = parent.controller.signal.reason; stop(why === 'halt' || why === 'budget' ? why : 'cancel'); };
      parent.controller.signal.addEventListener('abort', onAbort, { once: true });
      run.unlink = () => parent.controller.signal.removeEventListener('abort', onAbort);
    }
    active.set(runId, run);
    return { runId, run, done: execute(run, agent, prompt.trim()) };
  }

  // The one doorway into the dispatch pipeline for a run, used over MCP by Claude Code and directly by the API provider.
  function localTools(run) {
    return {
      listTools: () => registry.list(run.grants).map(t => ({ name: t.name.replace(/\./g, '_'), description: t.description, inputSchema: t.inputSchema })),
      callTool: (name, args) => registry.dispatch({ tool: name, args }, {
        emit: run.emit, newId, grants: run.grants, consent, interactive: run.interactive, signal: run.controller.signal, runId: run.runId, agentId: run.agentId,
        taint: run.taint, breaker: run.breaker, stop: run.stop, crew: crewApi(run), maxToolMs: 1_800_000,
        tainted: () => run.taint.tainted || [...run.workers.values()].some(j => j.tainted)   // did anything in this job read the web?
      })
    };
  }

  // ---------- the Chief's view of its crew (ctx.crew for delegation tools) ----------
  function crewApi(lead) {
    return {
      /** opts.shape(member) → a different shape for this worker run (the council), opts.preamble → what it's told first */
      start(workerId, task, opts = {}) {
        if (workerId === lead.agentId) return { error: 'You can\'t give a task to yourself.' };
        const w = roster.get(workerId);
        if (!w) return { error: `There is no crew member "${workerId}".` };
        if (!w.awake) return { error: `${w.name} is asleep until ${w.wakes}.` };
        const r = startRun({ agentId: workerId, prompt: task, interactive: lead.interactive, parent: lead, agentOverride: opts.shape ? opts.shape(w) : null, preamble: opts.preamble ?? null });
        if (r.error) return { error: r.error };
        const job = { workerId, workerRunId: r.runId, running: true, reason: null, text: '', tainted: false };
        job.done = r.done.then(res => { Object.assign(job, { running: false, reason: res.reason, tainted: !!res.tainted, text: String(res.text || '').slice(0, MAX_REPORT) }); return job; });
        lead.workers.set(r.runId, job);
        lead.emit('crew.dispatch', { workerId, workerRunId: r.runId, task: task.slice(0, 500) });
        return { workerRunId: r.runId };
      },
      /** Wait for the given jobs (at most `timeoutMs`, or until the lead is stopped). */
      async wait(ids, timeoutMs) {
        const jobs = ids.map(id => lead.workers.get(id) || { workerRunId: id, unknown: true });
        let timer;
        const giveUp = new Promise(r => { timer = setTimeout(r, timeoutMs); lead.controller.signal.addEventListener('abort', r, { once: true }); });
        await Promise.race([Promise.all(jobs.filter(j => j.done).map(j => j.done)), giveUp]);
        clearTimeout(timer);
        return jobs.map(j => ({ ...j, done: undefined }));
      },
      status() {
        return {
          maxWorkers: limits.maxWorkers ?? 2,
          crew: roster.public().filter(c => c.awake && c.id !== lead.agentId).map(c => ({ id: c.id, name: c.name, busy: busy(c.id) })),
          jobs: [...lead.workers.values()].map(j => ({ workerRunId: j.workerRunId, workerId: j.workerId, running: j.running, reason: j.reason }))
        };
      }
    };
  }

  return {
    /** Load today's spend from the ledger, for the daily limit. */
    async init() { const t = await ledger.totals(dayStart(clock.now())); todayUsd(); today.usd = t.usd; },

    /** Today's spend against the soft daily limit. */
    daily,

    /** Start a top-level job. Returns { runId, done } or { error, code? }. */
    start(opts) { const r = startRun({ ...opts, parent: null }); return r.error ? r : { runId: r.runId, done: r.done }; },

    /** Context for an MCP request, or null if the run/token doesn't match. */
    mcpContext(runId, token) {
      const run = active.get(runId);
      if (!run || !token || token.length !== run.token.length || !timingSafeEq(token, run.token)) return null;
      return localTools(run);
    },

    /** Stop workers that have made no progress for too long. Call every few seconds. */
    checkLiveness(now = clock.now()) {
      const stopped = [];
      for (const r of active.values()) {
        if (!r.parent || r.controller.signal.aborted) continue;
        const limit = r.toolsRunning > 0 ? LIVENESS.toolMs : LIVENESS.idleMs;
        if (now - r.lastProgress > limit) {
          r.emit('breaker.trip', { kind: 'no_progress', detail: `no progress for ${Math.round((now - r.lastProgress) / 1000)} s` });
          r.stop('stale'); stopped.push(r.runId);
        }
      }
      return stopped;
    },

    /** Mark a running job as having read untrusted content. */
    taintRun(runId, source) { const r = active.get(runId); if (r && r.taint.set(source)) r.emit('taint.set', { source }); return !!r; },

    /** "Revert this job": undo its file changes, newest first. */
    async revert(runId) {
      if (active.has(runId)) return { error: 'This job is still running. Wait for it to finish or stop it first.' };
      if (!undo) return { error: 'Undo is not available.' };
      const evs = await journal.read(runId);
      if (!evs.length) return { error: 'No such job.' };
      const results = await undo.revert(runId, { guard: guardPath, remote: remoteUndo ? r => remoteUndo(r) : undefined });
      const emit = bus.emitFor(runId, evs[0].agentId, Math.max(...evs.map(e => e.seq)) + 1);
      for (const r of results) if (['restored', 'removed', 'moved back', 'binned'].includes(r.result)) emit('undo.reverted', { undoId: r.undoId, path: r.path });
      await journal.flush();
      return { results };
    },

    /** Emit an event on a job that is still running. Returns false if it has ended. */
    emitTo(runId, type, payload) { const r = active.get(runId); if (!r) return false; return !!r.emit(type, payload); },

    cancel(runId) { const r = active.get(runId); if (!r) return false; r.controller.abort('cancel'); return true; },

    /** STOP: abort every run. */
    halt(by = 'user') {
      const n = active.size;
      for (const r of active.values()) { r.emit('station.halt', { by }); r.controller.abort('halt'); }
      return n;
    },

    active: () => [...active.values()].map(r => ({ runId: r.runId, agentId: r.agentId, parentRunId: r.parent?.runId || null })),

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
