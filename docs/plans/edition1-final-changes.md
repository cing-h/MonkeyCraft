# Edition 1: final changes (waiting list)

Status: COLLECTING. The user adds items here while testing MonkeyCraft. **Don't build any of them until the user says to make the final changes to Edition 1.** After that comes Edition 2.

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

Added 2026-11-06.

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

