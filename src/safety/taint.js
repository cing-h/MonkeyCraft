// The web-read lockout ("taint"). Once a job has read content from the web (or
// any other untrusted source), that content might contain instructions meant to
// trick the creature. So for the rest of that job it may only read: no commands,
// no file changes. The lockout can't be lifted mid-job; a new job starts clean.

export function makeTaint() {
  let source = null;
  return {
    get tainted() { return source !== null; },
    source: () => source,
    /** Mark the job tainted. Returns true the first time only. */
    set(src) { if (source !== null) return false; source = String(src || 'untrusted content'); return true; }
  };
}

/** Scopes a tainted job may still use. */
export const ALLOWED_WHEN_TAINTED = new Set(['read']);
