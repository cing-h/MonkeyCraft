// Settings API: read what each crew member uses and the spending limits, and change them.
import { send } from '../http/server.js';
import { validateSettings, MODELS, LIMIT_RANGES } from '../settings.js';

export function settingsRoutes({ store, roster, providers, limits, apply, brain = null, workspace = null, dataDir = null }) {
  const view = () => ({
    settings: store.get(),
    brain: brain ? { path: brain.root, saved: store.get().brain?.path || null, restartNeeded: !!store.get().brain?.path && store.get().brain.path !== brain.root } : null,
    effective: {
      crew: roster.public().filter(c => c.awake).map(({ id, name, role, provider, model }) => ({ id, name, role, provider, model })),
      limits: Object.fromEntries(Object.keys(LIMIT_RANGES).map(k => [k, limits[k]]))
    },
    options: {
      models: MODELS,
      providers: [
        { id: 'claude-code', label: 'Claude Code (your subscription)', available: true },
        { id: 'anthropic-api', label: 'Anthropic API (API key)', available: !!providers['anthropic-api']?.available, why: providers['anthropic-api']?.available ? null : 'No API key: set ANTHROPIC_API_KEY before starting MonkeyCraft.' }
      ],
      ranges: LIMIT_RANGES
    }
  });
  return [
    { method: 'GET', path: '/api/settings', handle: ({ res }) => send(res, 200, view()) },
    { method: 'POST', path: '/api/settings', handle: async ({ res, body }) => {
      const r = validateSettings(body, { crewIds: roster.ids(), workspace, dataDir });
      if (!r.ok) return send(res, 400, { error: r.errors.join('; ') });
      if (!r.value.brain && store.get().brain) r.value.brain = store.get().brain;   // a save that doesn't mention the Brain keeps its folder
      const wantsApi = Object.values(r.value.crew).some(c => c.provider === 'anthropic-api');
      if (wantsApi && !providers['anthropic-api']?.available) return send(res, 400, { error: 'No Anthropic API key is set, so nobody can use the API yet. Set ANTHROPIC_API_KEY and restart MonkeyCraft.' });
      await store.save(r.value); apply(r.value);
      send(res, 200, view());
    } }
  ];
}
