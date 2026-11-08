// Settings the user changes in the app, saved durably in data/settings.json:
// which provider and model each crew member uses, the spending limits, and
// where the Brain lives (that one takes effect when MonkeyCraft restarts).
// Environment variables give the starting defaults; saved settings override
// them; changes apply to jobs started afterwards. Every value is validated
// here, so a bad file or request can't set something unsafe.
//
// Injected IO only (fsp).

import path from 'node:path';
import { writeFileDurable } from './store/durable.js';

export const MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'];
export const PROVIDERS = ['claude-code', 'anthropic-api'];
// [min, max] for each limit the user may set
export const LIMIT_RANGES = {
  perRunUsd: [0.05, 50], perRunTokens: [10_000, 20_000_000], dailyUsd: [0.5, 1000],
  familyUsd: [0.1, 200], familyTokens: [10_000, 50_000_000]
};

/**
 * Why `p` can't be the Brain's folder, or null. The user decided the Brain stays
 * on this computer only, so cloud-synced folders (OneDrive, Dropbox, Google Drive,
 * iCloud) are refused, and it can't sit inside the workspace or MonkeyCraft's data.
 */
export function brainPathProblem(p, { workspace = null, dataDir = null } = {}) {
  if (typeof p !== 'string' || !p.trim()) return 'the Brain folder is empty';
  if (p.includes('\0') || p.length > 1000) return 'the Brain folder isn\'t a usable path';
  if (!path.isAbsolute(p)) return 'the Brain folder must be a full path (starting with /)';
  const n = path.resolve(p), low = n.toLowerCase();
  if (/\/(onedrive|dropbox|google ?drive|icloud ?drive|my drive)( [^/]*)?(\/|$)/.test(low)) return 'the Brain must stay on this computer, so it can\'t be in a cloud-synced folder (OneDrive, Dropbox, Google Drive or iCloud)';
  if (n === '/' || /^\/mnt\/[a-z]\/?$/.test(low) || /^\/(etc|usr|bin|sbin|lib|lib64|boot|proc|sys|dev|root|tmp)(\/|$)/.test(n)) return 'the Brain can\'t go in a system folder';
  const inside = (a, b) => b && (a === b || a.startsWith(b + '/') || b.startsWith(a + '/'));
  if (inside(n, workspace)) return 'the Brain can\'t overlap the workspace (the crew\'s ordinary tools work there)';
  if (inside(n, dataDir)) return 'the Brain can\'t overlap MonkeyCraft\'s own records';
  return null;
}

/** Validate a settings object. Returns { ok, value } or { ok: false, errors }. Unknown keys are dropped. */
export function validateSettings(input, { crewIds, workspace = null, dataDir = null }) {
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
  if (s.readOnly !== undefined) {   // folders the crew may read but never change (the user's Zettelkasten)
    const list = Array.isArray(s.readOnly) ? s.readOnly : null;
    if (!list || list.length > 10 || list.some(p => typeof p !== 'string' || !path.isAbsolute(p) || p.includes('\0') || path.resolve(p) === '/' || p.length > 1000)) errors.push('read-only folders must be a list of up to 10 full paths (starting with /)');
    else value.readOnly = [...new Set(list.map(p => path.resolve(p)))];
  }
  if (s.brain?.path !== undefined) {
    const why = brainPathProblem(s.brain.path, { workspace, dataDir });
    if (why) errors.push(why); else value.brain = { path: path.resolve(s.brain.path) };
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

export function makeSettingsStore({ fsp, file, crewIds, workspace = null, dataDir = null }) {
  let current = { crew: {}, limits: {} };
  return {
    async load() {
      try {
        const r = validateSettings(JSON.parse(await fsp.readFile(file, 'utf8')), { crewIds, workspace, dataDir });
        if (r.ok) { current = r.value; return { ok: true }; }
        return { ok: false, error: r.errors.join('; ') };
      } catch (e) { return e.code === 'ENOENT' ? { ok: true } : { ok: false, error: e.message }; }
    },
    get: () => structuredClone(current),
    /** Save a full settings object (already validated). */
    async save(value) { current = structuredClone(value); await writeFileDurable(fsp, file, JSON.stringify({ v: 1, ...current }, null, 1) + '\n'); return this.get(); }
  };
}
