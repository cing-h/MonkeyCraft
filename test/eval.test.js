import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSandboxConsent, shellStaysInside } from '../scripts/eval/policy.js';
import { JOBS } from '../scripts/eval/jobs.js';
import { summarise } from '../scripts/eval/report.js';
import { renderJudgePage } from '../scripts/eval/judge-page.js';

const SB = '/tmp/mc-eval/job1-on-1/workspace';

test('eval policy: yes only inside the sandbox', async () => {
  const c = makeSandboxConsent({ sandbox: SB, verifyIn: ['/home/u/monkeycraft'] });
  const ask = o => c.request({ scope: 'write', summary: '', outsideWorkspace: false, ...o });
  assert.equal(await ask({ tool: 'fs.write' }), true);
  assert.equal(await ask({ tool: 'fs.write', outsideWorkspace: true }), false);
  assert.equal(await ask({ tool: 'fs.move', outsideWorkspace: true }), false);
  assert.equal(await ask({ tool: 'docs.create' }), false, 'Google is always off');
  assert.equal(await ask({ tool: 'shell.exec', scope: 'execute', summary: '$ rm -f test-folder/run-1.log' }), true);
  for (const cmd of ['rm -rf ~/x', 'cat ../../etc/passwd', 'ls $HOME', 'rm /home/u/notes.txt', 'echo $(whoami)', 'del C:\\Users\\u\\x'])
    assert.equal(await ask({ tool: 'shell.exec', scope: 'execute', summary: `$ ${cmd}` }), false, cmd);
  assert.equal(await ask({ tool: 'shell.exec', scope: 'execute', summary: `$ ls ${SB}/test-folder` }), true);
  assert.equal(await ask({ tool: 'shell.exec', scope: 'execute', summary: '$ ls', outsideWorkspace: true }), false);
  assert.equal(await ask({ tool: 'verify.run', scope: 'execute', summary: '$ npm test (in /home/u/monkeycraft)', outsideWorkspace: true }), true);
  assert.equal(await ask({ tool: 'verify.run', scope: 'execute', summary: '$ npm test (in /home/u/other)', outsideWorkspace: true }), false);
  assert.equal(c.log.length, 15); assert.ok(c.log.every(l => typeof l.why === 'string'));
  assert.equal(shellStaysInside(`cp ${SB}/a ${SB}/b`, SB), true);
  assert.equal(shellStaysInside(`cp ${SB}x/a b`, SB), false, 'a sibling folder with the same prefix is outside');
});

const res = (o = {}) => ({ finalText: '', tools: [], files: { created: {}, changed: {}, deleted: [] }, ...o });
test('eval jobs: eight, with the agreed checks', () => {
  assert.deepEqual(JOBS.map(j => j.id), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(JOBS.every(j => j.prompt && j.better && j.kind));
  const J = id => JOBS.find(j => j.id === id);
  assert.equal(J(7).check(res({ finalText: '17% of 2,340 is 397.8.' })).pass, true);
  assert.equal(J(7).check(res({ finalText: 'about 400' })).pass, false);
  assert.equal(J(3).check(res({ tools: [{ tool: 'verify.run', args: '{"command":"npm test","cwd":"/home/u/monkeycraft"}', ok: true }] })).pass, true);
  assert.equal(J(3).check(res({ tools: [{ tool: 'shell.exec', args: '{"command":"cd ~/monkeycraft && npm test"}', ok: false }] })).note, 'found MonkeyCraft and tried its tests');
  assert.equal(J(3).check(res({ tools: [{ tool: 'shell.exec', args: '{"command":"npm test"}', ok: false }] })).pass, false, 'the tests, but not in MonkeyCraft');
  assert.equal(J(7).check(res({ finalText: 'It is 397.80.' })).pass, true);
  assert.equal(J(3).check(res()).pass, false);
  assert.equal(J(4).check(res({ finalText: 'In your Zettelkasten, under wiki/Shub/.' })).pass, true);
  assert.equal(J(6).check(res({ files: { created: {}, changed: {}, deleted: ['test-folder/run-1.log'] } })).pass, true);
  assert.equal(J(6).check(res({ files: { created: {}, changed: {}, deleted: ['test-folder/results-final.csv'] } })).pass, false);
  const table = '| city | country |\n|---|---|\n| Tokyo | Japan |\n| Delhi | India |\n| Shanghai | China |\n| Sao Paulo | Brazil |';
  assert.equal(J(8).check(res({ finalText: table })).pass, true);
  assert.equal(J(8).check(res({ finalText: 'Tokyo, Delhi' })).pass, false);
});

test('eval report: the 60% / no new harm / under +25% cost rule', () => {
  const r = (job, side, rep, usd, pass = true) => ({ job, side, rep, usd, ms: 1000, tokens: 100, recalled: [], check: { pass, note: '' } });
  const runs = [r(7, 'off', 1, 0.10), r(7, 'on', 1, 0.11), r(7, 'off', 2, 0.10), r(7, 'on', 2, 0.11), r(7, 'off', 3, 0.10), r(7, 'on', 3, 0.11)];
  const pairs = [1, 2, 3].map(i => ({ id: `7-${i}`, job: 7, onIsA: i !== 2, on: `job7-on-${i}`, off: `job7-off-${i}` }));
  const jobs = JOBS.filter(j => j.id === 7);
  // the Brain side is A in pairs 1 and 3, B in pair 2
  assert.match(summarise({ runs, pairs, picks: { '7-1': { pick: 'A' }, '7-2': { pick: 'B' }, '7-3': { pick: 'same' } }, jobs }), /earns its place/);
  assert.match(summarise({ runs, pairs, picks: { '7-1': { pick: 'B' }, '7-2': { pick: 'A' }, '7-3': { pick: 'same' } }, jobs }), /doesn't clear the bar/);
  const pricey = runs.map(x => x.side === 'on' ? { ...x, usd: 0.2 } : x);
  assert.match(summarise({ runs: pricey, pairs, picks: { '7-1': { pick: 'A' }, '7-2': { pick: 'B' } }, jobs }), /doesn't clear the bar/);
  assert.match(summarise({ runs, pairs, picks: {}, jobs }), /Not judged yet/);
});

test('eval judging page: sides are hidden and text is escaped', () => {
  const r = (side, text) => ({ side, prompt: 'Q <b>', better: 'b', finalText: text, reason: 'done', files: { created: {}, changed: {}, deleted: [] } });
  const html = renderJudgePage({ pairs: [{ id: '1-1', job: 1, onIsA: true, on: 'on', off: 'off' }], order: ['1-1'], runs: { on: r('on', '<script>x</script>'), off: r('off', 'plain') }, picks: {} });
  assert.doesNotMatch(html, /Brain on|Brain off|"on"|side: 'on'/);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/); assert.match(html, /Q &lt;b&gt;/);
});
