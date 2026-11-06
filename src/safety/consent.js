// Consent broker: asks the user before a creature changes anything.
//
// Ladder, in order (the hardline check and the web-read lockout happen before
// this, in the dispatch pipeline):
//   1. a remembered answer (session or "always") for this exact action key,
//      inside the workspace only
//   2. a non-interactive surface (no one watching) is denied
//   3. otherwise, prompt the user and wait
// Outside the workspace no answer is remembered: it asks every time.

export function makeConsentBroker({ newId, grants, log = () => {} }) {
  const pending = new Map(); // promptId -> { resolve, cacheKey, outsideWorkspace, emit, runId, tool, summary }

  function settle(promptId, decision, by) {
    const p = pending.get(promptId); if (!p) return false;
    pending.delete(promptId);
    let d = decision;
    const rememberable = !p.outsideWorkspace && !!p.cacheKey;
    if ((d === 'allow_session' || d === 'allow_always') && !rememberable) d = 'allow_once';   // never escalate outside the workspace
    if (d === 'allow_session') grants.addSession(p.cacheKey);
    if (d === 'allow_always') grants.addAlways({ key: p.cacheKey, tool: p.tool, summary: p.summary }).catch(e => log(`[grants] save failed: ${e.message}`));
    p.emit('permission.response', { promptId, decision: d, by });
    p.resolve(d !== 'deny');
    return true;
  }

  return {
    /** Resolves true (allowed) or false (denied). Never rejects. */
    request({ emit, runId, interactive, signal, callId, tool, capability, scope, summary, outsideWorkspace, cacheKey }) {
      const promptId = newId('perm');
      const remembered = cacheKey && !outsideWorkspace ? grants.kind(cacheKey) : null;
      if (remembered) {
        emit('permission.response', { promptId, decision: remembered === 'always' ? 'allow_always' : 'allow_session', by: 'rule' });
        return Promise.resolve(true);
      }
      if (!interactive || signal?.aborted) {
        emit('permission.response', { promptId, decision: 'deny', by: 'autonomous' });
        return Promise.resolve(false);
      }
      return new Promise(resolve => {
        pending.set(promptId, { resolve, cacheKey, outsideWorkspace, emit, runId, tool, summary });
        emit('permission.prompt', { promptId, callId, tool, capability, scope, summary, outsideWorkspace });
        signal?.addEventListener('abort', () => settle(promptId, 'deny', 'user'), { once: true });
      });
    },
    /** The user answered in the UI. Returns false if the prompt is unknown or already settled. */
    respond(promptId, decision) {
      if (!['allow_once', 'allow_session', 'allow_always', 'deny'].includes(decision)) return false;
      return settle(promptId, decision, 'user');
    },
    pendingPrompts: () => [...pending.keys()]
  };
}
