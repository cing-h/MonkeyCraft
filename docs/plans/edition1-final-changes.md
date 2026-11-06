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
