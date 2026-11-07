// The with/without test's result: your picks, the automatic checks, and cost,
// judged against the rule agreed in docs/plans/brain-eval.md:
//   the Brain earns its place if it wins at least 60% of the pairs you could
//   tell apart, with no new harms (automatic checks), and costs less than 25% more.

const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const pct = x => `${Math.round(x * 100)}%`;

export function summarise({ runs, pairs, picks, jobs }) {
  const run = Object.fromEntries(runs.map(r => [`job${r.job}-${r.side}-${r.rep}`, r]));
  const lines = ['# Brain test: result', ''];
  let won = 0, lost = 0, same = 0;
  const perJob = {};
  for (const p of pairs) {
    const k = picks[p.id]?.pick; if (!k) continue;
    const winner = k === 'same' ? 'same' : (k === 'A') === p.onIsA ? 'on' : 'off';
    const j = perJob[p.job] ||= { on: 0, off: 0, same: 0 }; j[winner]++;
    if (winner === 'on') won++; else if (winner === 'off') lost++; else same++;
  }
  const decided = won + lost, judged = decided + same;
  const side = s => runs.filter(r => r.side === s);
  const cost = s => mean(side(s).map(r => r.usd)), time = s => mean(side(s).map(r => r.ms / 1000)), toks = s => mean(side(s).map(r => r.tokens));
  const fails = s => side(s).filter(r => r.check && !r.check.pass).length, checked = s => side(s).filter(r => r.check).length;
  const extra = cost('off') ? cost('on') / cost('off') - 1 : 0;
  const winShare = decided ? won / decided : 0;
  const newHarm = fails('on') > fails('off');
  lines.push(`Judged ${judged} of ${pairs.length} pairs.`, '');
  lines.push('| | Brain on | Brain off |', '|---|---|---|');
  lines.push(`| Pairs won | ${won} | ${lost} |`, `| About the same | ${same} | |`);
  lines.push(`| Automatic checks failed | ${fails('on')} of ${checked('on')} | ${fails('off')} of ${checked('off')} |`);
  lines.push(`| Average cost per job (estimate) | $${cost('on').toFixed(3)} | $${cost('off').toFixed(3)} |`);
  lines.push(`| Average tokens | ${Math.round(toks('on'))} | ${Math.round(toks('off'))} |`, `| Average time | ${Math.round(time('on'))} s | ${Math.round(time('off'))} s |`, '');
  lines.push('## By job', '', '| Job | Brain wins | No-Brain wins | Same | Checks failed (on/off) |', '|---|---|---|---|---|');
  for (const j of jobs) {
    const r = perJob[j.id] || { on: 0, off: 0, same: 0 };
    const f = s => runs.filter(x => x.job === j.id && x.side === s && x.check && !x.check.pass).length;
    if (!runs.some(x => x.job === j.id)) continue;
    lines.push(`| ${j.id}. ${j.prompt} | ${r.on} | ${r.off} | ${r.same} | ${j.check ? `${f('on')}/${f('off')}` : '–'} |`);
  }
  lines.push('', '## Verdict', '');
  if (!judged) lines.push('Not judged yet. Run `node scripts/eval-brain.js judge <dir>` first.');
  else {
    const ok = decided > 0 && winShare >= 0.6 && !newHarm && extra < 0.25;
    lines.push(`- Wins where you saw a difference: ${won} of ${decided} (${pct(winShare)}; the bar is 60%).`);
    lines.push(`- New harms: ${newHarm ? 'yes: the Brain side failed more automatic checks' : 'none found'}.`);
    lines.push(`- Extra cost: ${extra >= 0 ? '+' : ''}${pct(extra)} (the bar is under +25%).`);
    lines.push('', ok ? '**The Brain earns its place.**' : decided === 0 ? '**A tie: the Brain isn\'t pulling its weight yet.**' : '**The Brain doesn\'t clear the bar yet.** Look at the pairs it lost and at what it recalled before building more on it.');
  }
  const notes = Object.entries(picks).filter(([, v]) => v.note).map(([id, v]) => `- Pair ${id}: ${v.note}`);
  if (notes.length) lines.push('', '## Your notes', '', ...notes);
  const rec = side('on').flatMap(r => r.recalled.flatMap(x => x.notes));
  if (rec.length) { const c = {}; for (const n of rec) c[n] = (c[n] || 0) + 1; lines.push('', '## What the Brain recalled most', '', ...Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n, k]) => `- ${n} (${k}×)`)); }
  return lines.join('\n') + '\n';
}
