// Spending limits.
// - Per job: at most `perRunUsd` (Claude Code also enforces this itself with
//   --max-budget-usd) and at most `perRunTokens` weighted tokens. Cache reads
//   count 1/10, as they're cheap. Subscription jobs show "$0", and their dollar
//   figure is only an estimate, so the token limit is what really caps them. A
//   warning goes out at 80%; at 100% the job is stopped.
// - Per day: `dailyUsd` is a soft limit. Once today's spend reaches it, a new
//   job needs the user's explicit go-ahead.
// Pure apart from the injected emit/stop callbacks.

export const weighTokens = u => (u.input || 0) + (u.output || 0) + (u.cacheWrite || 0) + Math.round((u.cacheRead || 0) * 0.1);

export function makeRunBudget({ perRunTokens, emit, stop }) {
  let warned = false, tripped = false, spent = 0;
  return {
    /** Live usage totals for this job: { input, output, cacheRead, cacheWrite }. */
    usage(u) {
      spent = weighTokens(u);
      if (!warned && spent >= 0.8 * perRunTokens) { warned = true; emit('budget.threshold', { scope: 'tokens', limit: perRunTokens, spent, hard: false }); }
      if (!tripped && spent >= perRunTokens) { tripped = true; emit('budget.threshold', { scope: 'tokens', limit: perRunTokens, spent, hard: true }); stop('budget'); }
      return spent;
    },
    get tripped() { return tripped; },
    get spent() { return spent; }
  };
}

/** Today's spend against the soft daily limit. `todayUsd` comes from the ledger. */
export function dailyStatus(todayUsd, dailyUsd) {
  return { spent: todayUsd, limit: dailyUsd, near: todayUsd >= 0.8 * dailyUsd, over: todayUsd >= dailyUsd };
}
