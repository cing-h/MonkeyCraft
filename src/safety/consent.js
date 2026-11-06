// Consent broker: asks the user before a creature changes anything.
//
// Ladder, in order (the hardline check happens before this, in the tool):
//   1. a session grant for this exact action key, inside the workspace only
//   2. a non-interactive surface (no one watching) is denied
//   3. otherwise, prompt the user and wait
// Outside the workspace there is no session grant: it asks every time.
// "Always allow" isn't offered yet (it arrives with M3's grant store).

export function makeConsentBroker({ newId }) {
  const pending = new Map();   // promptId -> { resolve, cacheKey, outsideWorkspace, emit, runId }
  const session = new Set();   // cacheKeys the user allowed for this session

  function settle(promptId, decision, by) {
    const p = pending.get(promptId); if (!p) return false;
    pending.delete(promptId);
    let d = decision;
    if (d === 'allow_always') d = 'allow_session';            // not offered yet; never escalate
    if (d === 'allow_session' && (p.outsideWorkspace || !p.cacheKey)) d = 'allow_once';
    if (d === 'allow_session') session.add(p.cacheKey);
    p.emit('permission.response', { promptId, decision: d, by });
    p.resolve(d !== 'deny');
    return true;
  }

  return {
    /** Resolves true (allowed) or false (denied). Never rejects. */
    request({ emit, runId, interactive, signal, callId, tool, capability, scope, summary, outsideWorkspace, cacheKey }) {
      if (cacheKey && !outsideWorkspace && session.has(cacheKey)) return Promise.resolve(true);
      const promptId = newId('perm');
      if (!interactive || signal?.aborted) {
        emit('permission.response', { promptId, decision: 'deny', by: 'autonomous' });
        return Promise.resolve(false);
      }
      return new Promise(resolve => {
        pending.set(promptId, { resolve, cacheKey, outsideWorkspace, emit, runId });
        emit('permission.prompt', { promptId, callId, tool, capability, scope, summary, outsideWorkspace });
        signal?.addEventListener('abort', () => settle(promptId, 'deny', 'user'), { once: true });
      });
    },
    /** The user answered in the UI. Returns false if the prompt is unknown or already settled. */
    respond(promptId, decision) {
      if (!['allow_once', 'allow_session', 'allow_always', 'deny'].includes(decision)) return false;
      return settle(promptId, decision, 'user');
    },
    pendingPrompts: () => [...pending.keys()],
    clearSession: () => session.clear()
  };
}
