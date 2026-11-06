// MonkeyCraft ape village: passive chatter. It's scenery, kept truthful:
//   - crew members chat only while they're free (idle), and sleep-talk only
//     while asleep; a busy crew member never says a word;
//   - lines about the crew's work are only said right after the matching
//     real event (notify), never made up;
//   - at most `maxBubbles` bubbles at once, each up long enough to read.
// Pure: positions and modes come in through step(); randomness is injected.

import { SOUNDS, SLEEP_SOUNDS, CONVERSATIONS, MUTTERS, SLEEP_TALK, EVENT_LINES } from './chatter-lines.js';

const FACT_TTL = 6;          // seconds an event stays fresh enough to remark on
const NEAR = 70;             // how close two villagers must be to chat (scene px)
const SCREEN_W = 320;

export function makeChatter({ rnd, maxBubbles = 2 }) {
  const bubbles = [];        // { id, ref, sound, meaning, age, life, faint, kind }
  let nid = 0, convo = null, nextTalk = 3 + rnd() * 5, nextSleep = 12 + rnd() * 15;
  const facts = [];
  const pick = a => a[Math.floor(rnd() * a.length)];
  const lifeOf = s => 2.6 + Math.min(3, s.length * 0.045);

  function say(sp, meaning, { sleep = false } = {}) {
    if (bubbles.length >= maxBubbles || bubbles.some(b => b.ref === sp.ref)) return false;
    const sound = sleep ? pick(SLEEP_SOUNDS) : pick(SOUNDS[sp.species] || SOUNDS.smith);
    bubbles.push({ id: ++nid, ref: sp.ref, sound, meaning, age: 0, life: lifeOf(meaning), faint: sp.kind === 'villager', kind: sp.kind });
    return true;
  }
  let screenW = SCREEN_W;   // the view's width (wider when zoomed out)
  const onScreen = sp => sp.x > 8 && sp.x < screenW - 8;
  const canTalk = sp => onScreen(sp) && (sp.kind === 'villager' || sp.mode === 'idle');

  return {
    /** A real event worth remarking on: { type: 'job_done'|'job_failed'|'asking'|'sent', agentId, name }. */
    notify(fact) { if (EVENT_LINES[fact.type]) facts.push({ ...fact, age: 0 }); },

    /**
     * Advance dt seconds. world.speakers: [{ ref, kind: 'crew'|'villager', species, mode, x, y }] in scene
     * coordinates (x on screen, 0–320). Returns the bubbles to show.
     */
    step(dt, world) {
      screenW = world.width || SCREEN_W;
      const speakers = world.speakers || [], byRef = new Map(speakers.map(s => [s.ref, s]));
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i]; b.age += dt;
        const sp = byRef.get(b.ref);
        // a crew member who becomes busy (or leaves the screen) stops talking at once
        const stillOk = sp && (b.kind === 'villager' || sp.mode === 'idle' || (b.sleep && sp.mode === 'asleep')) && onScreen(sp);
        if (b.age >= b.life || !stillOk) bubbles.splice(i, 1);
      }
      for (let i = facts.length - 1; i >= 0; i--) { facts[i].age += dt; if (facts[i].age > FACT_TTL) facts.splice(i, 1); }

      // 1. remark on a fresh real event, from someone else who's free and on screen
      if (facts.length && bubbles.length < maxBubbles) {
        const f = facts[0], subject = byRef.get(`crew:${f.agentId}`);
        const others = speakers.filter(s => canTalk(s) && s.ref !== `crew:${f.agentId}` && (!subject || f.type !== 'asking' || Math.abs(s.x - subject.x) > 60));
        if (others.length) { const sp = pick(others); if (say(sp, pick(EVENT_LINES[f.type]).replace('{name}', f.name))) facts.shift(); }
      }

      // 2. carry on a conversation
      if (convo) {
        const [a, b] = convo.refs.map(r => byRef.get(r));
        if (!a || !b || !canTalk(a) || !canTalk(b)) convo = null;
        else if (!bubbles.some(x => x.ref === a.ref || x.ref === b.ref)) {
          convo.gap -= dt;
          if (convo.gap <= 0) {
            if (convo.i >= convo.lines.length) { convo = null; nextTalk = 7 + rnd() * 9; }
            else if (say(convo.i % 2 ? b : a, convo.lines[convo.i])) { convo.i++; convo.gap = 0.45; }
          }
        }
      }

      // 3. start a new conversation, or a mutter
      nextTalk -= dt;
      if (!convo && nextTalk <= 0 && bubbles.length < maxBubbles) {
        const free = speakers.filter(canTalk), pairs = [];
        for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) {
          const p = free[i], q = free[j];
          if (p.kind === q.kind && Math.abs(p.x - q.x) < NEAR && Math.abs(p.y - q.y) < 40) pairs.push([p, q]);
        }
        const paired = new Set(pairs.flat().map(p => p.ref)), lone = free.filter(p => !paired.has(p.ref));
        if (pairs.length && !(lone.length && rnd() < 0.35)) { const [p, q] = pick(pairs); convo = { refs: rnd() < 0.5 ? [p.ref, q.ref] : [q.ref, p.ref], lines: pick(CONVERSATIONS), i: 0, gap: 0 }; }
        else if ((lone.length || free.length) && rnd() < 0.7) say(pick(lone.length ? lone : free), pick(MUTTERS));   // someone on its own mutters
        nextTalk = convo ? 0 : 6 + rnd() * 8;
      }

      // 4. now and then, a sleeper talks in its sleep
      nextSleep -= dt;
      if (nextSleep <= 0) {
        const sleepers = speakers.filter(s => s.kind === 'crew' && s.mode === 'asleep' && onScreen(s));
        if (sleepers.length && say(pick(sleepers), pick(SLEEP_TALK), { sleep: true })) bubbles[bubbles.length - 1].sleep = true;
        nextSleep = 18 + rnd() * 20;
      }
      return bubbles.map(b => ({ ...b }));
    },
    _bubbles: bubbles
  };
}
