# Edition 2: the Brain and the Demi-God Sage

Status: APPROVED 2026-11-07. Building phase 1.
Scope (the user's decision): Edition 2 is only the Brain and the Demi-God Sage. Schedules (Bell-ringer), chat apps, connectors and the desktop app wait until this is built and fleshed out.

---

## Part 1: In plain words (for you)

**The idea.** The village gets a shared Brain: its own Obsidian Zettelkasten. Every ape reads from it before a job and learns into it after one, the way Hermes Agent learns. The Brain also holds a profile of you: your goals, how you work and how you like to be told things. The apes use it so they understand you better. The Sage wakes up as a Demi-God, the keeper of the Brain. He interviews you, learns about you quietly, brings proposals to the council, and later uses Shub to give the other apes new skills and improve the ones they have.

**Your decisions (2026-11-07).**
- **Where the Brain lives:** a new vault of its own, outside OneDrive, so it stays on this computer only: `C:\Users\hayde\MonkeyCraftBrain`. You can open it in Obsidian like your Zettelkasten. Your personal Zettelkasten stays separate and is never written by the apes.
- **How the apes learn: two speeds.**
  - *Fast:* after each job, the apes save notes and lessons automatically. Every line says which job it came from. You can undo anything, and you can lock any note so nothing changes it.
  - *Careful:* changes to a **skill** (how an ape does its work) go through the Sage. He tests the change, then shows it to you at the council: Keep, Edit or Discard.
- **Your profile:** a deep interview with the Sage first, about ten minutes at most. After that he learns about you quietly from jobs and councils, and he still brings bigger additions to the council as proposals.

**Things you should know (honest limits).**
- The Brain is stored only on this computer. But when an ape *uses* part of it during a job, that text goes to Claude for thinking, like everything else in a job. Claude doesn't keep it, but it does leave the computer for that moment.
- **Poisoned memory is the biggest risk.** A bad web page could try to plant false "facts". So a job that has read the web can't write to the Brain by itself: what it learned becomes a proposal for you instead. This extends the web-read lockout you already have.
- **Leaks.** The Scout reads the web and can visit any address, so it could be tricked into sending your profile somewhere. The Scout therefore never sees your profile. It still gets its own lessons and skills.
- **Learning costs usage.** It happens after each job and at the council, not nonstop, and it has its own small spending limit inside the daily one.
- **Shub isn't finished yet.** The Sage first improves skills with a smaller tester built into MonkeyCraft, in Shub's format. When Shub is ready, he hands that work to Shub instead.
- **Mastery is real, not decoration.** Each ape's mastery level is worked out from its record: jobs done, lessons kept and skill versions approved. It isn't just a number that goes up.

**What you'll see, step by step.**
1. A Brain folder you can open in Obsidian, and a **Brain** panel in MonkeyCraft where you can browse, undo, lock or delete anything.
2. Apes that remember: before a job, each ape is given what it needs from the Brain, and the job log shows what it recalled.
3. **The Sage wakes** and holds your interview (about 10 minutes). Your profile appears in the Brain.
4. **Learning after every job:** lessons for the apes that worked, quiet notes about you, and proposal cards at the council.
5. **Skills and mastery:** each ape has skills that get better through tested, approved versions, and a mastery level you can see. A "Shub socket" waits for Shub.
6. **The Demi-God:** the Sage flies between the stories in ceremonial robes, with an aura that glows when he is really learning or teaching.

---

## Part 2: Build layer (for Claude)

One branch per phase, stacked; check in with the user after each one. `npm test` + `npm run check` before calling a phase done. No new runtime dependencies.

### The Brain vault (layout)
```
MonkeyCraftBrain/                 Obsidian-compatible; plain [[Title]] links; frontmatter on every note
  Home.md                         hub: what the Brain is, links to each area
  You/                            the profile: Goals.md, Who you are.md, How you like to work.md, ...
  Crew/<ape>/<ape>.md             each ape's hub: mastery, skills, recent lessons
  Crew/<ape>/Lessons/<title>.md   one lesson per note (atomic), Hermes lesson rules
  Skills/<ape>/<skill>/SKILL.md   open skill format (what Shub produces); versions/ holds old ones
  Notes/<title>.md                shared knowledge about the user's projects and computer
  Proposals/<id>.md               waiting for the council (Keep / Edit / Discard)
  .brain/                         MonkeyCraft-only: journal, undo snapshots, locks, discards, search index
  Log.md                          what was learned, when, from which job
```
Frontmatter: `title, kind (profile|lesson|skill|note|proposal), ape, source_job, created, updated, locked, tainted, uses, last_used`.

### Rules
- **Only `src/brain/*` writes the Brain.** Add the Brain folder to the hardline list for the ordinary fs, shell and write tools, so no tool can edit it around the journal. The apes reach it only through `brain.*` tools.
- **Every write is journaled:** snapshot → write tmp → fsync → rename. Removal only archives (`.brain/archive/`), and every change can be undone.
- **Locks:** the user can lock a note or a single line. Learning passes skip locked content.
- **Taint:** a run tainted by web content never writes to the Brain directly. Its learnings become proposals marked "came from a job that read the web".
- **Profile exposure:** an agent with network capability (the Scout) never gets `You/` in its prompt or through `brain.*`.
- **Hermes lesson rules:** the proposer is given the lesson-writing rules. A check rejects lessons that contain dates, ticket or job ids, or a duplicate of an existing lesson. A failure caused by the environment means "no lesson".
- **No "always learn" pressure.** A job with nothing worth keeping writes nothing (Shub's finding: extra rules hurt).
- **Events:** additive only in `src/events.js`: `brain.recall`, `brain.write`, `brain.undo`, `brain.proposal`, `brain.decision`, `sage.interview`, `skill.version`. The Sage's aura animates only from these.

### Phases
1. **`feature/brain-vault`: the Brain itself.**
   - `src/brain/{vault,journal,notes,search,locks}.js`: create the vault on first run, plus the journaled write/undo/archive and locks. Search is a small BM25 in plain JS over title, frontmatter and body, rebuilt incrementally.
   - Settings: the Brain path (default `/mnt/c/Users/hayde/MonkeyCraftBrain`), and a hardline entry for it.
   - Routes `src/routes/brain.js` and a **Brain panel** in the UI: browse, read, undo, lock or unlock, delete (archive).
   - *Check:* tests for journal crash-safety, undo, locks, the hardline block, and search ranking.
2. **`feature/brain-recall`: apes that remember.**
   - Before each run, a recall step builds a short **dossier** (a size budget of about 1.5k tokens): a profile summary (not for network agents), the ape's top lessons for this task, and its active skills. It's appended to the system prompt.
   - Tools for every ape: `brain.search`, `brain.read`; `brain.note` writes a shared note (fast speed; refused when tainted).
   - Each recall emits `brain.recall`; the Job log shows "remembered: …".
   - *Check:* the dossier stays inside the budget, the Scout never sees `You/`, and tainted runs can't call `brain.note`.
3. **`feature/sage-interview`: the Sage wakes.**
   - Roster: the Sage is `awake: true`, gets a persona as keeper of the Brain, and the tools `brain.*` plus `sage.*`.
   - **The interview:** a Sage job with a chat panel and a 10-minute timer. Most important questions first, no restricted topics (the user's decision): anything that makes the village more efficient, effective, accurate or better at communicating. Questions adapt to your answers: goals (life, work, projects), who you are, how you like updates, what to never do, what frustrates you. Any question can be skipped. When the time is up he wraps up, drafts the `You/` notes, and you approve that first draft once. After that he learns quietly.
   - *Check:* the timer ends the interview cleanly, nothing is written before you approve, and you can re-run the interview later.
4. **`feature/brain-learning`: learning after every job.**
   - After a job ends, a **reflection pass** (cheap model, its own budget) proposes lessons for each ape that worked and quiet profile notes.
     - Untainted, unlocked, and passes the lesson checks: written straight away (fast speed).
     - Tainted, or a big change to your profile: becomes a proposal instead.
   - **The council:** the Sage attends, presents proposals as cards (Keep / Edit / Discard), and reports what the village learned. A Discard is remembered so the same thing is never offered again.
   - **Retiring old lessons:** lessons that go unused are archived (`uses` / `last_used`), never deleted.
   - *Check:* the reflection pass respects taint, locks and discards, and stays within the learning budget.
5. **`feature/sage-skills`: skills, mastery and the Shub socket.**
   - Each ape loads its approved `SKILL.md` files. When lessons keep repeating, the Sage drafts a skill version. He tests it on a few small replay tasks with the cheap model ("does it beat the ape without it?", Shub's test), then brings a council card. A Keep makes a new version, with a snapshot of the old one.
   - **Mastery** is worked out from the record: jobs done, lessons kept, skill versions approved. It shows in the roster.
   - **Shub socket:** `src/brain/skill-improver.js` is an interface with a built-in implementation now, and Shub's later on. Skills already use Shub's format, so moving over is a swap.
   - *Check:* rejected versions never load, rollback works, and mastery only changes from real records.
6. **`feature/demigod-sage`: the Demi-God.**
   - The Sage flies: he hovers with a slow bob and glides between stories, without climbing.
   - **Ceremonial robes:** layered and flowing, with a stole, an embroidered hem, a sash and a headpiece, in blue with gold trim over his golden fur and blue face (golden snub-nosed monkey). The robes ripple as he flies.
   - **His aura:** a soft halo with drifting motes. It brightens and pulses only on `brain.*`, `sage.*` and `skill.version` events, and a thread of light goes to the ape he's teaching. His bathhouse gains a floating shrine.
   - Reduced motion is respected.
   - *Check:* the aura brightens only from events, and a screenshot review with the user.

### The user's answers (2026-11-07)
- **The Sage's look:** he becomes a **golden snub-nosed monkey** (golden fur, blue face). Robes are **blue with gold trim**; the aura stays in his blue light.
- **The interview:** no restricted topics. Gather as much as is useful for making the village more efficient, effective and accurate, and for communicating with the user better. Ask the most important questions first. In the user's words: "ask whatever you need to become better at your jobs, skills, become smarter, or communicate with me better." The user can still skip any question, and the profile is still stored only in the local Brain.
