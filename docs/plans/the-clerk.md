# The Clerk (final-changes item 1)

A capuchin crew member who works in Google Docs, Sheets and Slides through Google's official APIs. The full design is in `edition1-final-changes.md`, item 1. This file covers the build.

## Decisions (2026-11-06)
- **Colour:** ink green (a ledger/banknote green). It is used for the glow outline and the house windows.
- **Home:** a paper-stacked counting house on the plot reserved for the Clerk on Canopy 1.
- **Google calls:** plain REST with `fetch`. No `googleapis` package, so there is no new dependency. Only a small set of endpoints is needed (Drive files, Docs batchUpdate, Sheets values/batchUpdate, Slides batchUpdate), and the OAuth desktop flow (loopback redirect + PKCE) is short enough to write ourselves.
- **Permission:** `drive.file` only.

## Phases (one branch each, check in with the user after each)
1. **`feature/clerk-google`: connection and Drive basics.**
   - A Connect Google button in Settings, using the local browser sign-in (loopback + PKCE). The token is stored in `data/google-token.json` (the hardlined folder) and is refreshed automatically.
   - A guided setup page for the one-time Google Cloud steps.
   - Drive: find, open, rename, move to folder, and bin. Changing sharing and deleting outright are never offered.
   - A simulated Google server for the tests.
2. **`feature/clerk-docs`:** create a document; write and revise it (headings, lists, tables, exact edits). A backup copy is made in Drive before editing any file the user already had.
3. **`feature/clerk-sheets`:** create a sheet; read and write ranges, formulas and charts.
4. **`feature/clerk-slides`:** turn an outline into a deck with speaker notes.
5. **`feature/clerk-crew`: the Clerk in the roster and the village.**
   - Sprite, poses, the ink-green glow, the counting house on Canopy 1, and chatter (*"Chirr-chirr."*).
   - The Chief can hand it work (Scout → Writer → Clerk).
   - Every create or edit asks first with a preview, and "Revert this job" bins the files the job created.
   - A small live test against the user's real account. It needs the user's Google setup done first, and the run should stay short (5-hour limit).

## Needs from the user
Before Phase 1's live check, the user does the guided Google Cloud setup: create a project, turn on the four APIs, set the consent screen to testing mode with the user as the only user, and create a desktop-app sign-in key. Everything before that is tested against the simulated Google.
