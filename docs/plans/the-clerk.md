# The Clerk (final-changes item 1)

A capuchin crew member who works in Google Docs, Sheets and Slides through Google's official APIs. The full design is in `edition1-final-changes.md`, item 1. This file covers the build.

## Decisions (2026-11-06)
- **Colour:** ink green (a ledger/banknote green). It is used for the glow outline and the house windows.
- **Home:** a paper-stacked counting house on the plot reserved for the Clerk on Canopy 1.
- **Google calls:** plain REST with `fetch`. No `googleapis` package, so there is no new dependency. Only a small set of endpoints is needed (Drive files, Docs batchUpdate, Sheets values/batchUpdate, Slides batchUpdate), and the OAuth desktop flow (loopback redirect + PKCE) is short enough to write ourselves.
- **Permission:** `drive.file` only.

## Phases (one branch each, check in with the user after each)
1. **`feature/clerk-google`: connection and Drive basics.** DONE 2026-11-06. Live-checked on the user's real Drive the same day: connect, make a folder, find, rename, read, then revert (named back and binned).
   - A Connect Google button in Settings, using the local browser sign-in (loopback + PKCE). The key and sign-in are stored in `data/google/` (the hardlined folder) and is refreshed automatically.
   - A guided setup page for the one-time Google Cloud steps.
   - Drive: find, open, rename, move to folder, and bin. Changing sharing and deleting outright are never offered.
   - A simulated Google server for the tests.
2. **`feature/clerk-docs`:** create a document; write and revise it (headings, lists, tables, exact edits). A backup copy is made in Drive before editing any file the user already had.
   - **Picker (decided 2026-11-06, user chose it):** a "Let the Clerk open a file" button opens Google's own file picker. Each file the user picks is shared with MonkeyCraft, one at a time (still `drive.file`). This needs an API key: one more setup step (enable the Picker API, then create an API key). The app id is the number at the start of the client id.
   - Edits to a document not made in the same job: a backup copy goes in Drive first, once per document per job. Revert can't undo a Docs edit itself (the APIs have no version restore), so it points to the backup instead.
3. **`feature/clerk-sheets`:** create a sheet; read and write ranges, formulas and charts.
4. **`feature/clerk-slides`:** turn an outline into a deck with speaker notes.
5. **`feature/clerk-crew`: the Clerk in the roster and the village.**
   - Sprite, poses, the ink-green glow, the counting house on Canopy 1, and chatter (*"Chirr-chirr."*).
   - The Chief can hand it work (Scout → Writer → Clerk).
   - Every create or edit asks first with a preview, and "Revert this job" bins the files the job created.
   - A small live test against the user's real account. It needs the user's Google setup done first, and the run should stay short (5-hour limit).

## Needs from the user
Before Phase 1's live check, the user does the guided Google Cloud setup: create a project, turn on the four APIs, set the consent screen to testing mode with the user as the only user, and create a desktop-app sign-in key. Everything before that is tested against the simulated Google.

## Phase 1 notes (what was built)
- `src/google/auth.js` handles the sign-in. The key and sign-in are saved owner-only in `data/google/`. The access token refreshes a minute before it expires, one refresh at a time. A revoked or expired sign-in is turned into a plain "Connect Google again" message.
- `src/google/api.js` is the REST caller. After a 401 it retries once with a fresh sign-in. After a 429 or 503 it waits 2 s and retries once. Google's errors come out as plain sentences.
- `src/google/drive.js` covers find, read (Docs as text, Sheets as CSV, Slides as text), folder, rename, move, bin and copy. It also has `revertChange()`.
- `src/tools/google-drive.js` has six tools: `drive.find`, `drive.read`, `drive.folder`, `drive.rename`, `drive.move` and `drive.bin`. Each change asks first, every time (no cacheKey, so no "always allow"). There is no sharing tool and no delete.
- The undo store gained `saveRemote`/`settleRemote`, so "Revert this job" now bins, renames back, moves back and unbins. It skips anything that was changed again afterwards.
- `src/routes/google.js` serves the routes, and Settings has a Google section with the guided steps.
- The tools are registered but nobody is granted them yet. The Clerk gets them in phase 5.
- **Live check passed:** Google accepts the loopback redirect with a path (`/api/google/callback`).
- **Later:** files the user already had are invisible under `drive.file` until opened with MonkeyCraft. That needs the Google Picker, which is to be decided in phase 2. `drive.read` doesn't mark a job as tainted (the user's rule: only the Scout's web reads do).
