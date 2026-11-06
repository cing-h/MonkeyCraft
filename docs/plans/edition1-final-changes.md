# Edition 1: final changes (waiting list)

Status: BUILDING (the user said go on 2026-11-06). Order: item 2 → 3 → 4 → 1, one branch each, checking in after each.
- Item 2: DONE on `feature/swing-reanimation`.

Each item records what the user asked for, the decisions already made, and an outline of how to build it.

---

## 1. The Clerk: a capuchin who works in Google Docs, Sheets and Slides

Added 2026-11-06.

**What the user wants:** a crew member who writes papers in Google Docs, makes slideshows in Google Slides, works in Google Sheets, and so on.

**Decided:**
- **Route:** Google's official APIs (Docs, Sheets, Slides, Drive), with MonkeyCraft's own Google sign-in. Not Claude's built-in Google connectors, which would bypass MonkeyCraft's checks and the village. Not local Office files instead.
- **Character:** a capuchin, the famous tool-using monkey, called **The Clerk**.

**Planned design (from the proposal the user accepted):**
- **Tools:** Docs (create, write and revise, headings, lists and tables, exact edits), Sheets (create, read and write ranges, formulas, charts), Slides (an outline becomes a deck, with speaker notes) and Drive (find, open, rename, organise).
- **Safety:**
  - Least access by default: the Google `drive.file` permission, which covers only files MonkeyCraft created or that the user opened with it. Wider access would be opt-in later.
  - Every create or edit asks first, with a preview.
  - Never allowed: changing who a file is shared with, or deleting outright. Mistakes go to the Drive bin.
  - "Revert this job" bins the files the job created. Before editing a document the user already had, the Clerk makes a backup copy in Drive, because the APIs can't restore old Google Doc versions.
  - The Google sign-in is stored in the hardlined `data/` folder.
- **One-time user setup (guided):** a Google Cloud project with the four APIs on, a consent screen in "testing" mode with the user as the only user, a desktop-app sign-in key, and a **Connect Google** button in Settings (local browser sign-in).
- **Village:** the Clerk's home, for example a paper-stacked counting house, with windows that glow in its colour. Plus a sprite, poses and a glow outline. The Chief can hand it work, such as Scout researches → Writer drafts → Clerk builds the Google files.
- **Phases** (each on its own branch, checking in after each):
  1. Google connection, sign-in storage and Drive basics.
  2. Docs.
  3. Sheets.
  4. Slides.
  5. The Clerk in the roster and the village, and a live test.

  Everything is tested against a simulated Google before it touches the real account.
- **Open when building:** whether to add the `googleapis` package (pinned) or call the REST APIs with fetch (no new dependency). The Clerk's colour, and where its house goes in the village.

---

<!-- Add new items below as the user reports them, numbered in order. -->

## 2. Reanimate the swinging and movement, as smoothly and dynamically as possible

Added 2026-11-06. **DONE** (branch `feature/swing-reanimation`). What was built:
- `ui/station/ape/swing.js`: one pendulum brachiation engine for the crew and the villagers.
  - Energy pumping (speed builds and fades).
  - Continuous catches at the forward peak.
  - Ricochetal flight for the gibbon: release near the top of the forward swing, a ballistic arc under the same gravity, and a catch nearest the reaching hand once past the top of the arc.
  - A catch spring (the dip).
  - The reaching hand aims at the hold predicted from the swing's energy.
  - Hands ease (only the gripping hand is pinned), the torso swings on a spring, the legs tuck and trail, and the head stays steadier.
- Leaves shake loose at catches.
- The gibbon runs upright with its arms raised; the knuckle-walkers shift their weight more clearly; branch-walkers crouch before a jump; letting go of a swing carries its speed into the fall.
- Measured over a 70 s trip: the gibbon flies before 43 of its 58 catches; the body moves at most about 4 px a frame; the gripping hand is always on the hold; catch hand-offs are ≤ ~7 px. Tests are in `test/swing.test.js`.
- Not done: branches don't visibly bend, because they are pre-painted. Falling leaves show the catches instead.

**What the user wants:** watch https://www.youtube.com/watch?v=9rdn26Hpdwo ("How Fast Can Gibbons Swing Through the Forest?") and reanimate the swinging and movement of the monkeys in the village, crew and background villagers alike, as smoothly and dynamically as possible.

**Note:** Claude can't watch video, so only the page title was read. The design below rests on how gibbons are known to move, not on frames from that video. If the user wants specific moments matched, screenshots or a few frames from the video (as images) can be used as references.

**Planned design:**
- **Two swing styles**, chosen by speed and species:
  - *Continuous* (slow, always one hand on): the current pendulum, tuned.
  - *Ricochetal* (fast; gibbons especially): the ape lets go near the top of the forward swing and flies on a ballistic arc to the next hold, with no hand on the branch in between. Then it catches the hold with an outstretched arm and the swing absorbs the impact, a slight dip before the next pendulum.
- **Real momentum:**
  - Energy carries from swing to swing, so a fast ape speeds up over several swings, coasts, and slows by shortening its swings before it stops.
  - It can pump to build speed.
  - The gap it can cross grows with its speed.
- **Body dynamics:**
  - The torso rotates through the swing.
  - The legs tuck on the upswing and extend on the down-swing, then trail during flight.
  - The free arm reaches early for long gaps.
  - The head stays steadier than the body, as a real animal keeps its eyes level.
  - Fur or tail follow-through after a catch.
- **Branch reaction:** branches dip and spring back at each catch, and leaves rustle.
- **Ground and climbing:**
  - The gibbon runs upright with its arms raised for balance.
  - Chimps and gorillas knuckle-walk with a clearer weight shift.
  - Mid-climb transitions are smoother, launches and landings have more anticipation, and turns are softer.
- **Same truthful behaviour:** the modes and timings that come from events don't change; only how a creature moves between places does.
- **Checks:**
  - Frame-by-frame motion strips and per-frame jump measurements: no teleports, hands on the hold whenever they hold it, continuous flight arcs.
  - The existing station tests still pass.
  - A headless browser look at 20 fps.


## 3. Passive dialogue between the village members

Added 2026-11-06.

**What the user wants:** passive chatter between the monkeys in the village, written in monkey sounds, with the real English meaning in parentheses. For example: *"Hoo-hoo-hoo! (Nice weather for swinging.)"*

**Planned design:**
- **Speech bubbles:** small pixel bubbles over an ape's head. The sound is in bold, and the meaning is in parentheses in a smaller, softer type. The bubbles look clearly different from the crew's real status signs: the "…" plate for real thinking, and the yellow "?" and question bubble for real permission. Chatter can never be mistaken for work.
- **Sounds that match each species:**
  - gorilla: deep grunts (*"Hrrmph."*)
  - gibbon: rising whoops (*"Whoop-whoop-whooo!"*)
  - chimp: pant-hoots (*"Ooh-ooh-aah-aah!"*)
  - orangutan: kiss-squeaks (*"Mwah-squeak."*)
  - bonobo: high peeps (*"Hee-hee!"*)
  - mandrill: low rumbles (*"Grrrumf."*)
  - snow monkey: chirps (*"Kii-kii."*)
  - howler: roars (*"HOOOooOOH!"*)
  - capuchin (the Clerk, if built): trills (*"Chirr-chirr."*)
- **Conversations:**
  - Two apes near each other trade a short back-and-forth of two to four lines; a lone ape mutters now and then.
  - The background villagers chatter too, from their branch, with smaller, fainter bubbles.
  - The pacing is calm: at most one or two bubbles on screen at once, each up long enough to read.
- **Truthful station, kept:**
  - Chatter is scenery. It never claims work that isn't happening.
  - Crew members chat only when they're free (idle) or asleep (sleep-talk: *"Zzz-hoo… (Bananas…)"*).
  - Lines that mention the crew's work are only picked from real events. For example, after a job really finished: *"Ooh-aah! (The Smith just finished a job!)"*, or, after a real permission question: *"Hrrmph? (Someone's waiting for your OK.)"*
  - A crew member that's busy doesn't chat.
- **Written lines, not AI:** the lines are a hand-written pool of a few hundred, mixed and varied, so the chatter costs no tokens and can't say anything odd.
- **Controls:** a "Village chatter" on/off switch in Settings. Chatter is off when the system asks for reduced motion, and the bubbles are hidden from screen readers (scenery only).
- **Checks:**
  - Tests: no chatter from a busy crew member; work-related lines only after the matching real event.
  - Bubbles never overlap the question bubble.
  - A screenshot and a frame strip to judge readability.

## 4. Two-way link between a Claude Code session and the Chief

Added 2026-11-06. The user accepted all of the recommendations below.

**What the user wants:** the Claude Code session running in WSL (the one building MonkeyCraft) can give the Chief jobs, and the Chief can give that session jobs.

**Planned design:**
- **Session → MonkeyCraft (straightforward):**
  - MonkeyCraft offers outside Claude Code sessions a small, local-only toolset: *give a job* (to the Chief by default, or any awake crew member), *check a job / get its final report*, and *stop a job*. It would be an MCP server, or a tiny CLI over the existing local API, with its own access token stored in `data/`.
  - These jobs appear in the village and the Job log like the user's own, marked "from Claude Code".
  - Every change or command still asks **the user** on the MonkeyCraft screen. The outside session can never approve MonkeyCraft's permission questions.
- **Chief → session (the mailbox):**
  - The Chief gets a new tool, *ask Claude Code*, which drops a request into a MonkeyCraft mailbox (durable, in `data/`).
  - In the village, a **messenger toucan** flies off from the Chief's lodge with the note, and flies back when the answer arrives.
  - The session picks requests up when the user says "check the Chief's mailbox", or with a watcher that wakes the session when a note arrives (only while that session is open). The session does the work under Claude Code's own permission prompts in its terminal, then replies.
  - The Chief can wait for the answer (with a time limit) or carry on and collect it later, like crew.spawn plus crew.wait.
- **Not built:** MonkeyCraft starting full Claude Code sessions with all built-in tools by itself. That would bypass the village, MonkeyCraft's permission questions, undo and the spending limits.
- **Safety:**
  - Requests from the Chief are untrusted input. Requests that trace back to web content (the Scout) are labelled so. The session treats every request as information and confirms consequential actions with the user.
  - Neither side approves the other's actions: MonkeyCraft's questions stay on its screen, and Claude Code's stay in its terminal.
  - Every message in both directions is recorded in the Job log and the journal.
  - Only this computer can reach it: the toolset listens on 127.0.0.1 only, needs its token, and is refused from the crew's own tools, so crew members can't use it to give themselves extra jobs.
- **Checks:**
  - Tests: a job given from outside runs through the normal pipeline; outside sessions can't answer permission questions; the mailbox survives a restart; requests from web-reading jobs are labelled; the Chief's waiting has a time limit.
  - Live round trip: this session gives the Chief a job, and the Chief sends a request back through the mailbox.
