// Loop breaker. A creature stuck in a loop repeats the same call, or fails step
// after step. Each call is fingerprinted with FNV-1a over canonical JSON (key
// order doesn't matter). The same call more than `maxRepeats` times in one job
// is refused with an explanation, and `maxFailures` failed steps in a row stop
// the job as "no progress". Pure: no clock, no IO.

export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

export function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export function makeBreaker({ maxRepeats = 3, maxFailures = 6 } = {}) {
  const seen = new Map();
  let streak = 0;
  return {
    /** Before running a call. Returns null, or a trip { kind, detail } if the call must be refused. */
    check(tool, args) {
      const d = fnv1a(canonical({ tool, args }));
      const n = (seen.get(d) || 0) + 1; seen.set(d, n);
      return n > maxRepeats ? { kind: 'repeat', detail: `${tool} with the same arguments ${n} times in this job` } : null;
    },
    /** After a step. Returns a trip when too many steps in a row have failed. */
    record(failed) {
      streak = failed ? streak + 1 : 0;
      return streak >= maxFailures ? { kind: 'failure_streak', detail: `${streak} failed steps in a row` } : null;
    }
  };
}
