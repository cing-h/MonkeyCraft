# MonkeyCraft — Edition 1 plan

Status: draft, 2026-11-06. Owner: the user directs; Claude writes all code.
Before changing this plan, also load: memory `monkeycraft-decisions`, and the vault notes "Building my own StarNet" (hub) and "StarNet build reference".

---

## Part 1 — In plain words (for you)

**What Edition 1 does.** You open MonkeyCraft in a window and see the ape village. You type a job to the Chief, for example "find out why my script fails and fix it". The Chief makes a plan and hands pieces to the crew: Scout researches the web, Smith runs commands, the Archivist reads and files documents, the Writer writes text and the Inspector checks the result. You watch them hurry home through the jungle village and work inside. Every animation comes from something the AI is really doing.

**How it stays safe and cheap.**
- The crew can work anywhere on your computer (your choice). Its home base is a MonkeyCraft workspace folder.
- Anything that changes files or runs commands asks you first, unless you've already said yes to that kind of action. Changes outside the workspace always ask, every time.
- A short never-touch list is blocked outright: system folders, your keys and passwords, and MonkeyCraft's own records.
- Before a creature changes a file, MonkeyCraft saves a copy, so you can undo it.
- Once a creature has read a web page, it loses the ability to run commands for the rest of that job, so a malicious page can't make it do something dangerous.
- There is a per-job spending limit, a soft daily limit, and a big red STOP button that halts everyone.
- Because your subscription turns show as "$0", MonkeyCraft also counts tokens, so the limits still apply.

**What it runs on.** Your own signed-in Claude Code does the thinking (your subscription, personal use). An API-key option is built too, for anyone else who uses it later.

**Not in Edition 1** (planned for Edition 2+):
- Remembering you across jobs and learning skills (Sage)
- Scheduled jobs (Bell-ringer)
- Chat-app access, plug-in connectors and a proper desktop installer

The Sage and Bell-ringer appear on the floor, asleep, so nothing pretends to work when it doesn't.

**Milestones you'll be able to see:**
1. A chat box where one creature (Smith) answers and can run a safe command, with its events listed live.
2. The village screen replaces the list. The Smith walks, works and asks permission on screen.
3. The safety layer works: permission prompts, the web-read lockout, spending limits and STOP.
4. The Chief delegates to the five working crew members, who can run side by side.
5. The API-key option, settings, and recovery after a crash or restart.

---

## Part 2 — Build layer (for Claude)

### Stack
- **Runtime:** Node 22 LTS installed inside WSL; the sidecar must run where `claude` lives (`~/.local/bin/claude`). Today `npm` resolves to Windows; do not use the Windows node.
- **Server:** one sidecar process bound to `127.0.0.1:8787`. HTTP API plus one NDJSON stream per run and an SSE hub. Plain ESM JavaScript, no framework and no build step.
- **UI:** a browser page served by the sidecar (plain JS modules). The voxel renderer from the art page (artifact 9FoPZGP6EqqC553pVZKsnc) becomes `ui/station/`.
- **Tests:** `node:test`. Every pure module takes an injected clock and IO; only `src/main.js` touches the real clock, filesystem, network and processes.
- **Repo:** `~/monkeycraft`, git, small files. Don't build a 30k-line composition root: routes live in `src/routes/*`.

### Directory layout (target)
```
src/main.js            composition root (only real IO/clock)
src/events.js          FROZEN event contract + validator (additive-only, versioned)
src/bus.js             per-run emitter → NDJSON; SSE hub
src/loop.js            runAgentLoop (API provider path)
src/providers/claude-code.js   headless CLI adapter
src/providers/anthropic.js     API-key adapter (@anthropic-ai/sdk)
src/tools/registry.js  dispatch pipeline; tools/*.js (fs, shell, web, verify, write)
src/mcp/server.js      exposes registry tools to Claude Code over MCP (stdio)
src/safety/{grants,consent,taint,breaker,halt}.js
src/money/{ledger,pool,budget}.js
src/crew/{roster,orchestrate,liveness,concurrency}.js
src/store/{durable,journal}.js
ui/ (index.html, chat/, station/, settings/)
test/
```

### Key design: one safety pipeline for both providers
- **Claude Code provider:** spawn `claude -p --output-format stream-json --input-format stream-json --verbose --include-partial-messages` with:
  - `--tools ""`, which disables every built-in tool;
  - `--mcp-config <generated> --strict-mcp-config`, so only MonkeyCraft's MCP server is available;
  - `--permission-mode` set so MCP tools don't prompt in the CLI, because MonkeyCraft's consent broker decides instead;
  - `--system-prompt` (persona plus crew rules), `--model`, `--no-session-persistence`, `--setting-sources ""`, and `--max-budget-usd` as an outer seatbelt.

  Every tool call therefore enters `registry.dispatch()`. Map the stream-json messages (system/init, assistant deltas, tool_use, result with usage and total_cost_usd) to MonkeyCraft events. Before coding, verify these flags with `claude --help` on the installed version (2.1.319 has `--tools`, `--strict-mcp-config`, `--permission-mode`, `--max-budget-usd`, `--no-session-persistence`).
- **API provider:** use MonkeyCraft's own `runAgentLoop` with the same registry, called directly. Default model `claude-opus-5-5`, adaptive thinking, streaming. Use the claude-api skill when writing it.
- **Model call and run identity:** each crew member is one roster record, with its model and provider set per agent. A run binds one CLI process or one API loop to `{agentId, runId}`, and its MCP server instance knows that binding, so dispatch has `ctx`.

### Dispatch pipeline (port the StarNet order)
The order: parse error → unknown tool → grant gate → schema validate → consent → taint check → per-tool timeout and abort → run once.

It never throws. It returns `{ok, isError, content, summary}`. Write tools refuse truncated arguments; never auto-close a cut-off string.

### Crew → grants (Edition 1)

| Crew | Tools | Scope |
|---|---|---|
| Chief | `crew.dispatch`, `crew.spawn`, `crew.status`, read-only fs | delegate; no shell |
| Scout | `web.search`, `web.fetch` | read, network, taint source |
| Smith | `shell.exec` (default cwd = workspace), fs read/write | execute, consent |
| Archivist | fs list/read/write/move (anywhere not hardlined) | write, consent |
| Writer | `doc.write` / `doc.edit` (text files) | write, consent |
| Inspector | `verify.run` (test commands from an allowlist), fs read | execute, consent |
| Sage, Bell-ringer | none (asleep until Edition 2) | — |

- **Reach is the whole computer (user decision Q1).**
  - `~/MonkeyCraftWorkspace/` is the default cwd and the "home" scope.
  - Resolve every path, symlinks included, before checking it.
  - Mutations inside the workspace follow the normal ladder (a cached grant is allowed).
  - Mutations outside the workspace prompt every time: no permanent grant, and denied on any non-interactive surface.
  - The hardline deny list applies to both reads and writes:
    - `/etc /usr /bin /boot /proc /sys`
    - `/mnt/c/Windows`, `/mnt/c/Program Files*`
    - `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.config/gh`, `~/.claude/` credentials
    - `.env*` files, browser profile folders, and MonkeyCraft's own `data/` (ledger, journal, grants).
  - Shell commands must match the denylist patterns `rm -rf /`, `mkfs`, `dd of=/dev`, `shutdown` and `format`. They run with cwd set to the workspace unless the user approves another cwd.
- **Undo store:** before any write, move or delete, copy the prior bytes to `data/undo/<runId>/` and log them in the journal. A "Revert this job" button is in M3. Shell side effects can't be undone this way, so shell commands prompt with the exact command shown.
- A delegated worker gets the attenuated intersection of the lead's grants and its own, never their union.

### Safety and money defaults (StarNet lessons)
- **Consent ladder:** hardline deny → cached grant (session or permanent) → read-only auto-allow → prompt the user in the UI. On a non-interactive surface, deny.
- **Taint:** after any `web.*` or MCP-result read, revoke `shell.exec`, `verify.run` and writes for the rest of the run. Journal it.
- **Money:**
  - per-run cap of $2 by default;
  - a soft daily cap of $25;
  - a token ceiling for subscription runs, where cache reads count 1/10;
  - a shared family spend pool with reservations for the lead and its workers;
  - an append-only ledger.
- **Loop breaker:** FNV-1a digests of canonical JSON for repeated identical calls. Pause after 3 passes with no progress.
- **Liveness:** a worker goes stale after 450 s with no progress, or 1,200 s if a tool is running.
- **Concurrency:** a gate defaulting to 2 creatures in flight.
- **STOP:** `halt.killAll()` aborts every run and kills child CLI processes.
- **Durability:** `writeFileDurable` (temp file, fsync, rename, directory fsync). Journal deltas, not snapshots. Never replay a tool intent that has no recorded result.

### Truthful station (UI rule)
Creatures animate only from events. Each event type changes the station like this:

| Event | What the station shows |
|---|---|
| `run.start` | Walk to station |
| `tool_call` | Work pose, emissives on |
| `permission.prompt` | Stop and show a "?" plate with Allow / Deny buttons |
| `waiting` | Idle at station |
| `run.end` | Return to wander |
| `error` | Slump, with a red pill on the card |

The renderer keeps 2 px per voxel, a 55° tilt, 45° camera steps and 10 fps steps. Clicking a creature opens its run log instead of toggling it.

### Milestones and acceptance checks
1. **M0 Setup — DONE 2026-11-06** (Node v22.23.4 via nvm; 7 tests green; the freeze test is mutation-checked):
   - Node 22 in WSL, the repo, `node --test` green, lint-free;
   - `events.js` frozen at v1 with a validator test.
2. **M1 One creature — DONE 2026-11-06.** 27 tests pass. In a live run, the Smith ran `ls -la` after an on-screen prompt; the ledger row was recorded as a subscription run (3,862 tokens). Killing the sidecar mid-prompt left a clean journal; on restart it was closed as interrupted, with an unsettled ledger row. Live events go over SSE (`/api/events`), with replay from the journal at `/api/runs/:id`; there is no per-run NDJSON stream yet.
   - *Finding:* the orphaned `claude -p` outlived the killed sidecar by a few seconds. It's harmless, since its only tools are inside MonkeyCraft. M3 adds a durable child-PID file and kills leftovers at startup, after checking each process's `/proc/<pid>/cmdline`.
   - Original scope:
   - the Claude Code adapter, the MCP tool server, the registry with `fs.read` and `shell.exec`, the bus, the chat UI and the ledger;
   - *check:* the user asks the Smith to `ls` the workspace; the events stream; the ledger row is written; killing the sidecar mid-run leaves a consistent journal.
3. **M2 Station — DONE 2026-11-06.** 32 tests pass.
   - The voxel engine now lives in `ui/station/engine.js`.
   - `ui/station/state.js` is a pure event→mode reducer: asleep, asking, working, error, talking, ready, idle. A fast tool's work pose is held 1.2 s so it can be seen.
   - `ui/station/scene.js` renders the floor: plates (? ! … Z), sparks and lights only in working mode, and a question bubble anchored over the asking creature.
   - Clicking a creature or its strip chip filters the job log.
   - Verified in real headless Chrome screenshots: idle floor, and the live permission bubble over the Smith.
   - **Redesign (2026-11-06, the user's request):** the floor is now a VILLAGE (`ui/station/village.js`). It's a grass island 300×184 voxels with cobbled roads, a square and dirt lanes, trees, lamps, a well and a pond.
     - Each crew member has a medieval building: smithy, archive, lookout tower, weaver's cottage, chapel, shrine and clock tower. The Voidwyrm is perched on a magic tower at the back.
     - Working = the creature walks the road graph to its door and goes INSIDE, and the building's light layer glows in its colour. Asking, ready, talking and error = waits at the door with a plate. Asleep = dozes on its doorstep.
     - The canvas is 640×424 at 2 px per voxel, about 5 ms a frame. Dev render: `node scripts/render-station.js out.png [steps] [k=mode,…] [yawSteps]`.
   - **Ape village (2026-11-06, the user's choice after a 2D trial):** the voxel village is replaced by a side-scrolling jungle village of apes, in `ui/station/ape/` (fb, cast, scenery, world, villagers, frame, scene). The interface (`makeStation`, `modeOf`, `pick`, `anchor`) is unchanged. Crew IDs are now `chief scout smith archivist writer inspector sage ringer`. It renders 320×180 at 20 steps a second; the village scrolls (drag, ◀ ▶, arrow keys) and jumps to whoever asks for permission. Dev render: `node scripts/render-station.js out.png [steps] [k=mode,…] [cameraX]`. Verified: 32 tests pass, plus a live run in which the Smith asked from its smithy door, ran `ls -la` once allowed, and finished (`done`, ~4k tokens). Plan: `docs/plans/ape-village-m3-m4.md`.
   - Original scope:
   - port the renderer, then add the event → animation mapping and the consent plate;
   - *check:* no animation fires without a matching event (tested with a scripted event feed).
4. **M3 Safety:**
   - grants, consent, taint, caps, breaker, STOP, the hardline list, the outside-workspace prompt and the undo store;
   - *check:* unit tests for every ladder rung, a taint test (a web read, then `shell.exec`, is refused), a cap test using fake priced and unpriced runs, and STOP killing a child process;
   - *check:* a symlink-escape test (a workspace link pointing into `~/.ssh` is denied), and "Revert this job" restoring an edited outside file.
5. **M4 Crew:**
   - the roster, `crew.dispatch` and `crew.spawn` with the shared pool, liveness and concurrency;
   - *check:* the Chief splits "research X and write a summary file" into the Scout plus the Writer; worker spend rolls up into the lead's pool; the lead receives only the workers' final messages.
6. **M5 Finish:**
   - the API-key provider (key in an env var for now, keychain later), a settings panel, and crash recovery;
   - *check:* the same job runs on both providers through the same pipeline.

### Decisions (answered 2026-11-06)
- Q1 Reach: **the whole computer**, with the hardline list, a prompt for every change outside the workspace, and the undo store.
- Q2 Shell: **a browser tab on localhost** for Edition 1. The desktop app comes later.
- Q3 Code origin: **fresh code** that borrows StarNet's designs. No StarNet code is copied.
- Q4 Crew: **five working**. The Sage and Bell-ringer are asleep until Edition 2.
