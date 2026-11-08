# Edition 1 audit (MVP lens)

Written 2026-11-07 at the user's request: "Audit Edition One too, we may leave it untouched for now, but it would be good to know if there are glaring issues." Nothing here is being changed yet.

The questions for each feature: does it make the crew's work for the user better, and could it do harm?

## The evidence
- **Real use is tiny.** The ledger holds 20 jobs, all on 2026-11-06, and many were build checks.
  - By ape: Smith 9, Chief 6, Archivist 2, Scout 1, Writer 1, Clerk 1, Inspector 0.
  - 1 council, 1 job from Claude Code, 0 permission denials.
  - Total cost: about $0.28 (subscription estimate).
- **Where the effort went.** About half the code is the village animation (~3,800 lines in `ui/`) and half is the harness (~3,700 lines in `src/`). Five of the seven "final changes" were visual: swinging, chatter, the canopy stories, the Chief roaming, and the village revamp.

## Glaring issues
1. **The core idea of Edition 1 is unproven.** A Chief who delegates to six specialists hasn't been shown to beat one capable ape with all the tools. Delegation adds cost, waiting time and lost context (a worker sees only its task, and the Chief sees only its report). With 20 jobs, we can't know. *Suggested check:* add "Chief + crew vs one ape" to the with/without test later.
2. **Running out of the subscription limit looks like a mysterious failure.** It happened on 2 of 20 jobs. The Job log shows Claude's raw message as an error with the code `success`, and nothing explains that the limit is the cause or when it resets. **FIXED 2026-11-07** (`feature/limit-message`): the Job log now says the subscription's usage limit is used up, when it resets, and that an API key can keep a crew member going.
3. **A possible freeze after Scout jobs.**
   - What was seen: headless-Chrome screenshots froze on one frame. Edition 1's interface does it too.
   - What was ruled out: a Node replay of the village code runs fine.
   - Not confirmed in a real browser; the user will report it if it happens.
4. **Settings can be lost across versions.** An older MonkeyCraft that is still running drops settings it doesn't know when you save (this happened to the Brain folder). *Mitigation:* restart after updating. A real fix (keep unknown keys) is small.

## Feature by feature

| Feature | Verdict | Note |
|---|---|---|
| Safety pipeline (hardline, prompts, undo, web lockout, budgets, STOP) | Keep | Essential. Low cost, protects against real harm. |
| Claude Code subscription + API provider | Keep | Essential. |
| Village animation | Keep, freeze it | It is the product's identity, but it's the biggest code area and where hidden bugs live. No more visual work until the core is proven. |
| Chief + 5 specialists | Keep, test it | The central assumption (issue 1). |
| The Clerk (Google) | Keep | Real capability; used once. Its value depends on the user's real need for Google files. |
| Council at the Ring | Watch | Met once. The daily council runs by itself (after 3 finished jobs), so it spends without being asked. Value unknown. |
| Village chatter | Harmless extra | Cosmetic. It can be switched off. |
| Claude Code link (toucan) | Watch | Used once. Useful if the user works in Claude Code often. |
| Settings, crash recovery, Job log replay | Keep | Basic reliability. |

## Suggested order (not started)
1. The Brain with/without test (`docs/plans/brain-eval.md`), which also gives us a harness to test issue 1.
2. ~~Fix issue 2~~ (done 2026-11-07).
3. Decide on the council's automatic meetings once there is real use.
