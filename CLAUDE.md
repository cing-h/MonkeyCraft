# MonkeyCraft — notes for Claude

General rules first: the owner's standing instructions for every project (plan first, one feature per session, permission to create sessions, a branch per feature, saving tokens, helper agents) live in cing-h/claude-standards and are installed as ~/.claude/CLAUDE.md. If they aren't loaded in this session, read https://github.com/cing-h/claude-standards/blob/main/CLAUDE.md before doing anything else.
The user directs and never writes code; Claude writes all of it. Explain changes in plain language.

- **Plan:** `PLAN.md` (Edition 1, milestones M0–M5, decisions). Read it before starting work, and keep its milestone status current.
- **Background:** the vault notes "Building my own StarNet" and "StarNet build reference" (design source; fresh code only, no StarNet code copied).
- **Node:** Node 22 lives in WSL via nvm and is not on the default PATH. Prefix commands with `. ~/.nvm/nvm.sh &&`. Never use the Windows node at `/mnt/c/Program Files/nodejs`.
- **Checks:** run `npm test` (node:test) and `npm run check` (syntax gate) before calling anything done.
- **Zettelkasten:** the project has its own folder in the user's vault, `wiki/MonkeyCraft/` (hub note "MonkeyCraft"). After each milestone (and any big design change), add or update notes there in one reviewed claude-obsidian transaction: what was built, decisions made, and what's next.

## Rules
- `src/events.js` is a FROZEN, additive-only contract. You may add types or optional fields and extend the snapshot in `test/events.test.js`. Never rename, remove or retype anything.
- The UI animates only from events (truthful station).
- Pure modules take injected clock/IO. Only `src/main.js` touches the real clock, filesystem, network and child processes.
- Keep files small. Routes go in `src/routes/*`, with no giant composition root.
- Tool dispatch never throws; tool writes refuse truncated arguments.
- Reach is the whole computer, so every path or shell change goes through: hardline list → outside-workspace prompt → undo copy (see PLAN.md).
- No runtime dependencies without a reason. Pin exact versions when one is added.
- Remove the Claude Co-author line after any changes or additions to the Repo.

## Seeing the UI
You can't see a browser, so take a screenshot with the user's Windows Chrome in headless mode, using a throwaway profile under `%LOCALAPPDATA%\Temp\acshot`. Then Read the PNG.
```
W=$(wslpath "$(cmd.exe /c 'echo %LOCALAPPDATA%' | tr -d '\r')")/Temp/acshot; mkdir -p "$W"; WW=$(wslpath -w "$W")
"/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu --no-first-run --hide-scrollbars \
  --user-data-dir="$WW\\profile" --window-size=1500,900 --timeout=3000 "--screenshot=$WW\\shot.png" http://localhost:8787/
```
- Don't use `--virtual-time-budget`: the SSE stream never goes idle, so it hangs.
- Never `pkill -f <pattern>` with a pattern that also appears in your own command line, because it kills your own shell.
