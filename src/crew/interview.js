// The Sage's interview: a timed, adaptive conversation that becomes the first
// draft of the user's profile in the Brain (You/).
//
//   - The Sage asks one question at a time with sage.ask, which waits for the
//     user's answer (or a skip) in the interview panel.
//   - About ten minutes. When time is up, sage.ask says so and the Sage wraps
//     up with sage.draft_profile. A few minutes later the job is stopped anyway.
//   - Nothing is written to the Brain until the user approves the draft (and
//     they may edit it first). Approval writes through the Brain's journal, so it
//     can be undone, and the user's locks still hold.
//   - Privacy: the questions, answers and draft live only in memory here, then
//     in the Brain. The job is private: its words and these tools' arguments are
//     never written to the job journal, only counts and states (sage.interview).
//
// Injected: runs, brain, clock, newId, setTimer.

import { safeTitle } from '../brain/notes.js';

export const INTERVIEW = { minutes: 10, graceMinutes: 3, maxNotes: 8, maxNoteChars: 4000 };
const SECRET = /(sk-ant-[\w-]{10,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bpassword\s*[:=]\s*\S+)/i;

export const INTERVIEW_TASK = `Hold the user's interview for the Brain. You have about ${INTERVIEW.minutes} minutes.

Your goal: learn whatever will make the village better at its jobs, smarter, and better at communicating with the user. That means their goals (life, work and projects), who they are, how they like to work and to be told things, what they never want the crew to do, what frustrates them, the tools and setup they use, and anything else that would help. The user has said no topic is off-limits, but they can skip any question.

- Ask the most important questions first.
- Ask one short, plain question at a time with sage.ask, and adapt to the answers. Follow up when an answer opens up something important.
- Don't ask about what the Brain already knows (see your memory above). You can read the You/ notes with brain.read.
- Never ask for passwords, keys or account numbers.

When sage.ask says time is up, when the user wants to finish, or when you have enough, call sage.draft_profile once.
- Give it 2 to 6 notes for the You/ folder, with titles such as "Goals", "Who the user is", "How the user likes to work" and "Never do".
- Write each note as a clear, factual summary in plain Markdown, about the user in the third person ("The user ...").
- Include only what they actually said or clearly meant. Don't guess.
- If a note with that title already exists, write the whole updated note.
- Nothing is saved until the user approves.

Speak to the user only through sage.ask. When you're done, reply with one short line that has no personal details in it.`;

// `runs` may be a function returning the run host (it's made after the tool registry).
export function makeInterview({ runs: runsOrGet, brain, clock, newId, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const runs = new Proxy({}, { get: (_, k) => (typeof runsOrGet === 'function' ? runsOrGet() : runsOrGet)[k] });
  let cur = null;   // { id, runId, startedAt, endsAt, status, turns, pending, draft, finishing, timer }

  const secondsLeft = () => cur ? Math.max(0, Math.round((cur.endsAt - clock.now()) / 1000)) : 0;
  const emit = (state, extra = {}) => { if (cur) runs.emitTo(cur.runId, 'sage.interview', { state, asked: cur.turns.length, secondsLeft: secondsLeft(), ...extra }); };
  const forget = () => { if (cur?.timer) clearTimer(cur.timer); cur = null; };

  function settle(answer) {
    const p = cur?.pending; if (!p) return false;
    cur.pending = null; p.clear?.(); p.resolve(answer); return true;
  }

  return {
    /** Start the interview job. Returns { id, runId } or { error }. */
    start() {
      if (cur && cur.status !== 'ended') return { error: cur.status === 'drafted' ? 'The last interview\'s draft is waiting: approve or discard it first.' : 'The interview is already going.' };
      forget();
      if (!brain.status().ready) return { error: 'The Brain isn\'t available, so there is nowhere to keep what the Sage learns.' };
      const r = runs.start({ agentId: 'sage', prompt: INTERVIEW_TASK, source: 'interview', private: true });
      if (r.error) return { error: r.error };
      const now = clock.now();
      cur = { id: newId('interview'), runId: r.runId, startedAt: now, endsAt: now + INTERVIEW.minutes * 60_000, status: 'running', turns: [], pending: null, draft: null, finishing: false };
      // a backstop: if the Sage hasn't wrapped up a few minutes after time is up, the job is stopped
      cur.timer = setTimer(() => { if (cur && cur.status === 'running') runs.cancel(cur.runId); }, (INTERVIEW.minutes + INTERVIEW.graceMinutes) * 60_000);
      r.done.then(() => {
        if (!cur || cur.runId !== r.runId) return;
        settle('(the interview has ended)');
        if (cur.status === 'running') { cur.status = 'ended'; cur.turns = []; }   // no draft: nothing to keep
        if (cur.timer) clearTimer(cur.timer);
      });
      emit('started');
      return { id: cur.id, runId: r.runId };
    },

    /** What the interview panel shows. Lives only in memory. */
    view() {
      if (!cur) return { active: false };
      return { active: cur.status === 'running', status: cur.status, runId: cur.runId, secondsLeft: secondsLeft(), minutes: INTERVIEW.minutes, turns: cur.turns.map(t => ({ q: t.q, a: t.a, skipped: t.skipped })), waiting: !!cur.pending, draft: cur.draft };
    },

    /** The user's answer to the waiting question, or a skip. */
    answer({ text = '', skip = false }) {
      if (!cur?.pending) return { error: 'The Sage isn\'t waiting for an answer right now.' };
      const t = cur.turns[cur.turns.length - 1], a = String(text).trim().slice(0, 4000);
      if (!skip && !a) return { error: 'Type an answer, or press Skip.' };
      t.a = skip ? null : a; t.skipped = !!skip;
      settle(skip ? '(the user skipped this question)' : a);
      emit(skip ? 'skipped' : 'answered');
      return { ok: true };
    },

    /** The user wants to finish now: the Sage wraps up at its next step. */
    finish() {
      if (!cur || cur.status !== 'running') return { error: 'There is no interview going.' };
      cur.finishing = true;
      settle('(the user wants to finish now: wrap up and call sage.draft_profile)');
      return { ok: true };
    },

    /** Save the (possibly edited) draft to You/ in the Brain. Returns { saved: [rel], failed: [{ title, error }] }. */
    async approve({ notes } = {}) {
      if (!cur || cur.status !== 'drafted') return { error: 'There is no draft to approve.' };
      const list = checkNotes(notes ?? cur.draft);
      if (list.error) return list;
      const saved = [], failed = [];
      for (const n of list.notes) {
        const rel = `You/${n.title}.md`, existed = !(await brain.read({ rel })).error;
        const w = await brain.write({ rel, body: `${n.text.trim()}\n`, by: 'sage', sourceJob: cur.runId });
        if (w.error) failed.push({ title: n.title, error: w.error });
        else { saved.push(rel); if (w.changeId) await runs.emitAfter(cur.runId, 'brain.write', { path: rel, op: existed ? 'replace' : 'create', changeId: w.changeId }); }
      }
      await runs.emitAfter(cur.runId, 'sage.interview', { state: 'approved', asked: cur.turns.length });
      forget();
      return { saved, failed };
    },

    async discard() {
      if (!cur || cur.status === 'running') return { error: 'There is no draft to discard.' };
      await runs.emitAfter(cur.runId, 'sage.interview', { state: 'discarded', asked: cur.turns.length });
      forget();
      return { ok: true };
    },

    /** The Sage's two interview tools. They only work inside the interview job. */
    tools: [
      {
        name: 'sage.ask', capability: 'interview', scope: 'read', privateArgs: true, timeoutMs: (INTERVIEW.minutes + INTERVIEW.graceMinutes + 1) * 60_000,
        description: 'Ask the user one question in the interview and wait for the answer. The answer may be "(the user skipped this question)". When time is up, it tells you to wrap up instead.',
        inputSchema: { type: 'object', properties: { question: { type: 'string', maxLength: 600, description: 'One short, plain question' } }, required: ['question'], additionalProperties: false },
        async run(args, ctx) {
          if (!cur || cur.runId !== ctx.runId) return { isError: true, content: 'sage.ask only works during the user\'s interview.', summary: 'not in an interview' };
          if (cur.finishing) return { content: 'The user wants to finish now. Wrap up: call sage.draft_profile.', summary: 'finishing' };
          if (secondsLeft() <= 0) return { content: 'Time is up. Wrap up now: call sage.draft_profile with what you learned.', summary: 'time is up' };
          if (cur.pending) return { isError: true, content: 'Wait for the answer to your last question.', summary: 'already asking' };
          cur.turns.push({ q: String(args.question).trim(), a: null, skipped: false });
          emit('asked');
          const answer = await new Promise(resolve => {
            cur.pending = { resolve };
            const left = Math.max(0, cur.endsAt - clock.now());
            const t = setTimer(() => settle('(time is up and the user didn\'t answer this one: wrap up now and call sage.draft_profile)'), left + 60_000);
            ctx.signal?.addEventListener('abort', () => settle('(the interview was stopped)'), { once: true });
            cur.pending.clear = () => clearTimer(t);
          });
          const tail = secondsLeft() <= 0 ? '\n\n[Time is up: wrap up now and call sage.draft_profile.]' : secondsLeft() < 90 ? `\n\n[About ${secondsLeft()} seconds left.]` : '';
          return { content: answer + tail, summary: 'the user answered' };
        }
      },
      {
        name: 'sage.draft_profile', capability: 'interview', scope: 'read', privateArgs: true,
        description: 'End the interview with a draft of the user\'s profile: 2 to 6 notes for the Brain\'s You/ folder. The user reviews and approves it; nothing is saved before that.',
        inputSchema: { type: 'object', properties: { notes: { type: 'array', description: 'Notes: [{ "title": "Goals", "text": "Markdown about the user" }]' } }, required: ['notes'], additionalProperties: false },
        async run(args, ctx) {
          if (!cur || cur.runId !== ctx.runId || cur.status !== 'running') return { isError: true, content: 'sage.draft_profile only works once, at the end of the user\'s interview.', summary: 'not in an interview' };
          const list = checkNotes(args.notes);
          if (list.error) return { isError: true, content: `${list.error}. Fix it and call sage.draft_profile again.`, summary: 'draft not usable' };
          settle('(drafted)');
          cur.draft = list.notes; cur.status = 'drafted';
          emit('drafted', { secondsLeft: secondsLeft() });
          return { content: 'The draft is in front of the user. Nothing is saved until they approve it. Now end with one short line, without personal details.', summary: `drafted ${list.notes.length} note${list.notes.length > 1 ? 's' : ''}` };
        }
      }
    ]
  };
}

/** Validate a profile draft: [{ title, text }]. Returns { notes } or { error }. */
export function checkNotes(notes) {
  if (!Array.isArray(notes) || !notes.length) return { error: 'the draft needs at least one note' };
  if (notes.length > INTERVIEW.maxNotes) return { error: `the draft can have at most ${INTERVIEW.maxNotes} notes` };
  const out = [], titles = new Set();
  for (const n of notes) {
    const title = safeTitle(n?.title), text = typeof n?.text === 'string' ? n.text.trim() : '';
    if (!title) return { error: 'every note needs a usable title' };
    if (!text) return { error: `"${title}" is empty` };
    if (text.length > INTERVIEW.maxNoteChars) return { error: `"${title}" is longer than ${INTERVIEW.maxNoteChars} characters` };
    if (SECRET.test(text)) return { error: `"${title}" holds something that looks like a password or key, and those never go in the Brain` };
    if (titles.has(title.toLowerCase())) return { error: `two notes are called "${title}"` };
    titles.add(title.toLowerCase()); out.push({ title, text });
  }
  return { notes: out };
}
