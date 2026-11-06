// Spend ledger: one immutable line per finished (or crashed) run, in
// data/ledger.ndjson. Lines are appended and fsynced, never rewritten.
//
// Row: { runId, agentId, provider, billing: 'api'|'subscription'|'unknown',
//        usd, tokens, turns, reason, settled, ts }
// `settled: false` marks a run whose real spend is unknown (it crashed).
// For subscription runs, usd is Claude Code's API-price estimate, not money
// charged, so caps also have to count tokens.

import { appendDurable, parseNdjson } from '../store/durable.js';

const BILLING = new Set(['api', 'subscription', 'unknown']);

export function makeLedger({ fsp, file }) {
  return {
    async append(row) {
      const r = {
        runId: String(row.runId), agentId: String(row.agentId), provider: String(row.provider || 'unknown'),
        billing: BILLING.has(row.billing) ? row.billing : 'unknown',
        usd: Number.isFinite(row.usd) ? row.usd : 0, tokens: Number.isInteger(row.tokens) ? row.tokens : 0,
        turns: Number.isInteger(row.turns) ? row.turns : 0, reason: String(row.reason || 'unknown'),
        settled: row.settled !== false, ts: row.ts
      };
      await appendDurable(fsp, file, JSON.stringify(r) + '\n');
      return r;
    },
    async rows() {
      try { return parseNdjson(await fsp.readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    },
    /** Totals for rows with ts >= sinceTs: { usd, tokens, runs, unsettled } */
    async totals(sinceTs = 0) {
      const t = { usd: 0, tokens: 0, runs: 0, unsettled: 0 };
      for (const r of await this.rows()) {
        if (r.ts < sinceTs) continue;
        t.usd += r.usd; t.tokens += r.tokens; t.runs++; if (!r.settled) t.unsettled++;
      }
      return t;
    }
  };
}
