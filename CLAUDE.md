# AutoCraft — notes for Claude

The user directs and never writes code; Claude writes all of it. Explain changes in plain language.

- **Plan:** `PLAN.md` (Edition 1, milestones M0–M5, decisions). Read it before starting work, and keep its milestone status current.
- **Background:** the vault notes "Building my own StarNet" and "StarNet build reference" (design source; fresh code only, no StarNet code copied).
- **Node:** Node 22 lives in WSL via nvm and is not on the default PATH. Prefix commands with `. ~/.nvm/nvm.sh &&`. Never use the Windows node at `/mnt/c/Program Files/nodejs`.
- **Checks:** run `npm test` (node:test) and `npm run check` (syntax gate) before calling anything done.

## Rules
- `src/events.js` is a FROZEN, additive-only contract. You may add types or optional fields and extend the snapshot in `test/events.test.js`. Never rename, remove or retype anything.
- The UI animates only from events (truthful station).
- Pure modules take injected clock/IO. Only `src/main.js` touches the real clock, filesystem, network and child processes.
- Keep files small. Routes go in `src/routes/*`, with no giant composition root.
- Tool dispatch never throws; tool writes refuse truncated arguments.
- Reach is the whole computer, so every path or shell change goes through: hardline list → outside-workspace prompt → undo copy (see PLAN.md).
- No runtime dependencies without a reason. Pin exact versions when one is added.
