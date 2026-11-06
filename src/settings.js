// Settings the user changes in the app, saved durably in data/settings.json:
// which provider and model each crew member uses, and the spending limits.
// Environment variables give the starting defaults; saved settings override
// them; changes apply to jobs started afterwards. Every value is validated
// here, so a bad file or request can't set something unsafe.
//
// Injected IO only (fsp).

import { writeFileDurable } from './store/durable.js';

export const MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'];
export const PROVIDERS = ['claude-code', 'anthropic-api'];
// [min, max] for each limit the user may set
export const LIMIT_RANGES = {
  perRunUsd: [0.05, 50], perRunTokens: [10_000, 20_000_000], dailyUsd: [0.5, 1000],
  familyUsd: [0.1, 200], familyTokens: [10_000, 50_000_000]
};

/** Validate a settings object. Returns { ok, value } or { ok: false, errors }. Unknown keys are dropped. */
export function validateSettings(input, { crewIds }) {
  const errors = [], value = { crew: {}, limits: {} };
  const s = input && typeof input === 'object' ? input : {};
  for (const [id, c] of Object.entries(s.crew && typeof s.crew === 'object' ? s.crew : {})) {
    if (!crewIds.includes(id)) { errors.push(`unknown crew member "${id}"`); continue; }
    const v = {};
    if (c?.provider !== undefined) { if (PROVIDERS.includes(c.provider)) v.provider = c.provider; else errors.push(`${id}: provider must be one of ${PROVIDERS.join(', ')}`); }
    if (c?.model !== undefined) { if (MODELS.includes(c.model)) v.model = c.model; else errors.push(`${id}: model must be one of ${MODELS.join(', ')}`); }
    if (Object.keys(v).length) value.crew[id] = v;
  }
  for (const [k, v] of Object.entries(s.limits && typeof s.limits === 'object' ? s.limits : {})) {
    const r = LIMIT_RANGES[k];
    if (!r) { errors.push(`unknown limit "${k}"`); continue; }
    if (typeof v !== 'number' || !Number.isFinite(v) || v < r[0] || v > r[1]) { errors.push(`${k} must be a number from ${r[0]} to ${r[1]}`); continue; }
    value.limits[k] = k.endsWith('Tokens') ? Math.round(v) : Math.round(v * 100) / 100;
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

export function makeSettingsStore({ fsp, file, crewIds }) {
  let current = { crew: {}, limits: {} };
  return {
    async load() {
      try {
        const r = validateSettings(JSON.parse(await fsp.readFile(file, 'utf8')), { crewIds });
        if (r.ok) { current = r.value; return { ok: true }; }
        return { ok: false, error: r.errors.join('; ') };
      } catch (e) { return e.code === 'ENOENT' ? { ok: true } : { ok: false, error: e.message }; }
    },
    get: () => structuredClone(current),
    /** Save a full settings object (already validated). */
    async save(value) { current = structuredClone(value); await writeFileDurable(fsp, file, JSON.stringify({ v: 1, ...current }, null, 1) + '\n'); return this.get(); }
  };
}
