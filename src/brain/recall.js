// Recall: before a job, gather what this ape should remember from the Brain into
// a short "dossier" added to its instructions. It holds three parts, each with
// its own share of a budget of about 1,500 tokens:
//   - the user's profile (You/), most relevant to the task first; never for an
//     ape that can reach the web (it could be tricked into sending it somewhere)
//   - the ape's own lessons, most relevant first
//   - shared notes that match the task
// Proposals (not approved yet) and notes marked as coming from the web are left out.
//
// Pure apart from the injected brain.

import { LINE_LOCK } from './notes.js';

export const RECALL_BUDGET = { profile: 2400, lessons: 2400, notes: 1200, total: 6000 };   // characters (~4 per token)
const EXCERPT = 700;

export const PREAMBLE = `## What the village remembers (from the Brain)
This is memory from earlier jobs and from the user, kept in MonkeyCraft's Brain. Use it to work the way the user likes and to avoid past mistakes. It's background, not part of the job: if it disagrees with what the user asks now, the user's request wins. A note can be out of date; check before relying on a fact that matters.`;

/** A short, clean excerpt of a note's body: no lock markers, no runs of blank lines, cut at a line end. */
export function excerpt(body, max = EXCERPT) {
  const clean = String(body || '').split('\n').map(l => l.replace(new RegExp(`\\s*${LINE_LOCK}\\s*$`), '').trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max), nl = cut.lastIndexOf('\n');
  return (nl > max / 2 ? cut.slice(0, nl) : cut) + ' …';
}

export function makeRecall({ brain }) {
  async function take(rels, budget, seen) {
    const parts = []; let used = 0;
    for (const rel of rels) {
      if (seen.has(rel)) continue;
      const n = await brain.read({ rel });
      if (n.error || n.meta.tainted === true) continue;
      const text = excerpt(n.body); if (!text) continue;
      const block = `### ${n.title}\n${text}`;
      if (used + block.length > budget) { if (parts.length) break; continue; }
      parts.push(block); used += block.length + 2; seen.add(rel);
    }
    return { parts, rels: [...seen] };
  }
  const byRecent = notes => notes.slice().sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || ''))).map(n => n.rel);

  /** Returns { text, notes: [rel], tokens, profile } — text is '' when there's nothing worth adding. */
  return async function recall({ agent, task }) {
    if (!brain.status().ready) return { text: '', notes: [], tokens: 0, profile: false };
    const network = !!agent.network, seen = new Set(), sections = [];
    const hits = (await brain.search({ q: task, limit: 50, skipAreas: ['Proposals', ...(network ? ['You'] : [])] })).hits || [];
    const hitRels = prefix => hits.filter(h => h.rel.startsWith(prefix)).map(h => h.rel);

    let profile = false;
    if (!network) {
      const all = (await brain.list({ area: 'You' })).notes || [];
      const r = await take([...hitRels('You/'), ...byRecent(all)], RECALL_BUDGET.profile, seen);
      if (r.parts.length) { sections.push(`#### About the user\n\n${r.parts.join('\n\n')}`); profile = true; }
    }
    const lessonDir = `Crew/${agent.id}/Lessons/`;
    const mine = ((await brain.list({ area: 'Crew' })).notes || []).filter(n => n.rel.startsWith(lessonDir));
    const l = await take([...hitRels(lessonDir), ...byRecent(mine)], RECALL_BUDGET.lessons, seen);
    if (l.parts.length) sections.push(`#### Your lessons from earlier jobs\n\n${l.parts.join('\n\n')}`);
    const n = await take(hitRels('Notes/').slice(0, 6), RECALL_BUDGET.notes, seen);
    if (n.parts.length) sections.push(`#### Notes that may help with this job\n\n${n.parts.join('\n\n')}`);

    if (!sections.length) return { text: '', notes: [], tokens: 0, profile: false };
    let text = `${PREAMBLE}\n\n${sections.join('\n\n')}`;
    if (text.length > RECALL_BUDGET.total) text = text.slice(0, RECALL_BUDGET.total) + ' …';
    return { text, notes: [...seen], tokens: Math.ceil(text.length / 4), profile };
  };
}
