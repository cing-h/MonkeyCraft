# Plan: ape village in the app, then M3 Safety, then M4 Crew

Status: APPROVED by the user 2026-11-06. Phase 1 DONE (ape village in the app, plus the crew glow). Phase 2 DONE (M3 Safety). Phase 3 DONE (M4 Crew). Decision during Phase 3: the user chose to keep the web-read lockout on the Scout only. Q-web answered: (a) Claude Code's own web search. Order chosen by the user: port the ape look first, then M3, then M4.
Each phase has its own branch, and I check in with you when each phase is done before starting the next.

## In plain words (for you)

**Phase 1 — The ape village becomes the real app** (branch `feature/ape-village`)
- The jungle village replaces the voxel village on the app's main screen. The Chief, Scout, Smith and the rest take over from the Voidwyrm, Hollow Plate, Cinder Smith and so on, with the same jobs.
- The screen keeps its current layout: the village on the left (drag or use the arrow keys to scroll), and the Job log with the prompt box on the right, restyled in the jungle look.
- Nothing changes in how jobs run. The Smith is still the only one awake, so you can test it straight away: give it a job and watch it hurry home, go inside, and come out waving "?" when it needs your OK.

**Phase 2 — Milestone 3, safety** (branch `feature/m3-safety`)
- **Remembered answers:** "Yes, always" or "Yes, this session" for actions inside the workspace. Anything outside the workspace still asks every time.
- **Undo:** a file-writing tool that saves a copy before every change, plus a "Revert this job" button.
- **Web-read lockout:** once a creature has read a web page, it can't run commands or write files for the rest of that job.
- **Spending limits:** $2 per job, a soft $25 per day, and a token limit for subscription jobs (which show $0). The screen warns when a limit is near.
- **Loop breaker:** a creature repeating the same action with no progress gets paused.
- **STOP** also cleans up any leftover Claude processes, including after a crash.

**Phase 3 — Milestone 4, the crew** (branch `feature/m4-crew`)
- The Chief wakes up. You give it the job, and it splits the job and hands pieces to the Scout (web research), Smith (commands), Archivist (files), Writer (text) and Inspector (checks). Up to two work at once.
- Each worker only gets the tools its job needs. A worker's spending comes out of the same pot as the Chief's, and the Chief sees only each worker's final answer.
- In the village, the Chief sends workers off from its lodge, and you watch each one go home and work. The Job log shows each worker's part under the main job.
- One decision is needed before this phase (see Q-web below).

## Build layer (for Claude)

### Phase 1
- Split `spikes/ape-village/apevillage.js` into `ui/station/ape/`: `fb.js` (framebuffer, materials, shading), `cast.js` (SPECIES, poses, fk, drawApe), `scenery.js` (painters), `world.js` (layers, doors, branch lines), `frame.js` (foliage frame and vines), `villagers.js` (the background brachiators), `scene.js`.
- `scene.js` keeps the current `makeStation(canvas, { modeOf, reduced })` interface (`step`, `redraw`, `pick`, `anchor`) plus `scrollBy`/`scrollTo`/`camera`, so `ui/app.js` changes stay small. `state.js` (the event→mode reducer) is unchanged.
- Crew IDs become `chief scout smith archivist writer inspector sage ringer` in `src/crew/roster.js`, `ui/station/state.js` and the app. Agent IDs are free strings in `src/events.js`, so the frozen contract is untouched. Old journals with old IDs still replay as text.
- Rewrite the personas (the Smith becomes a chimpanzee blacksmith; awake/asleep stays as M1–M2).
- `ui/index.html` and `ui/app.css`: camera rotation buttons → scroll buttons; jungle theme tokens from the prototype.
- Remove the voxel `engine.js`, `village.js` and the old `scene.js` (still in git history). `scripts/render-station.js` renders the ape scene headless instead.
- *Checks:* `npm test` and `npm run check` pass; headless Chrome screenshots of the idle village and of the live permission bubble over the Smith; one live run (the Smith lists the workspace).

### Phase 2 (M3) — as specified in PLAN.md "Safety and money defaults"
- `src/safety/grants.js` (session plus permanent, persisted durably to `data/grants.json`), the ladder in `consent.js`, and `taint.js` (per-run, journaled). `breaker.js` uses FNV-1a canonical digests and pauses after 3 passes with no progress. `halt.js` uses a child PID file at `data/children.json`, reaped at startup after checking `/proc/<pid>/cmdline`.
- `src/money/pool.js` and `budget.js`: run cap, soft daily cap, subscription token ceiling (cache reads ×0.1), and `budget.threshold` events.
- `src/store/durable.js`: `writeFileDurable`. Undo store at `data/undo/<runId>/`, plus a new `fs.write` tool (refuses truncated arguments) and `POST /api/runs/:id/revert`.
- *Checks* from PLAN.md M3: every ladder rung, taint (a web read followed by `shell.exec` is refused, using a stub web tool), caps with fake priced and unpriced runs, STOP killing a child, the symlink escape, and Revert restoring an edited outside file.

### Phase 3 (M4) — as specified in PLAN.md "Crew → grants"
- Roster grants per the table, with the ape IDs. `crew.dispatch`, `crew.spawn` and `crew.status` are Chief-only MCP tools. A worker's grants are the intersection of its own and the lead's, never their union. Shared family pool with reservations, liveness (450 s, or 1,200 s with a tool running), and a concurrency gate of 2. The lead receives only workers' final messages.
- Tools: `fs.list` and `fs.move` for the Archivist; `doc.write` and `doc.edit` for the Writer; `verify.run` (allowlisted test commands) for the Inspector; `web.fetch` and `web.search` for the Scout (taint sources).
- UI: the run tree in the Job log, and worker dispatch shown from the Chief's lodge.
- *Check:* the Chief splits "research X and write a summary file" between the Scout and the Writer, with spend rolling up to the lead.

### Open question for the user (needed before Phase 3)
- **Q-web: how the Scout searches the web.**
  - (a) Use Claude Code's own web search inside the Scout's run, observed through the event stream and counted as a taint source. This is simplest, uses your subscription, and needs no extra account.
  - (b) A separate search service with its own API key.

  `web.fetch` (reading a page you or the search found) is built in-house either way.
