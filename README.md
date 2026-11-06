# MonkeyCraft

A personal AI crew that does jobs on your own computer, shown as a jungle village of apes. You give the Chief a job. It splits the job into pieces and hands them to the crew: the Scout researches the web, the Smith runs commands, the Archivist files documents, the Writer drafts text and the Inspector checks the work. You watch each one hurry home through the village and work, and every animation comes from something the AI is really doing.

## Run it

Needs Node 22 and, for the default setup, a signed-in [Claude Code](https://claude.com/claude-code) (`claude`).

```bash
npm install
npm start            # then open http://localhost:8787
```

## How it stays safe

- Anything that changes a file or runs a command asks you first. You can remember an answer ("this session" or "always"), but only inside the workspace folder (`~/MonkeyCraftWorkspace`). Outside it, MonkeyCraft asks every time.
- System folders, keys and passwords, and MonkeyCraft's own records can never be touched.
- Every file change keeps an undo copy. **Revert this job** puts things back, and it never overwrites anything you edited afterwards.
- Once a crew member has read the web, it can't run commands or change files for the rest of that job.
- There are spending limits per job, per job-and-its-crew, and a soft daily limit. **STOP** halts everyone.

## Two ways to think

Open **Settings** (or go to `http://localhost:8787/#settings`) to choose, for each crew member, what it thinks with and which model it uses:

- **Claude Code (your subscription).** This is the default, for personal use. Claude Code runs with its own tools switched off, so every action goes through MonkeyCraft's checks.
- **Anthropic API (API key).** This option is for anyone without a Claude subscription. Set `ANTHROPIC_API_KEY` before `npm start`. MonkeyCraft runs its own agent loop through the same checks.

## Settings by environment variable

| Variable | Default | What it sets |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Turns on the Anthropic API option |
| `MONKEYCRAFT_PORT` | 8787 | The local port |
| `MONKEYCRAFT_WORKSPACE` | `~/MonkeyCraftWorkspace` | The crew's home folder |
| `MONKEYCRAFT_MAX_RUN_USD` | 2 | Dollar limit per job |
| `MONKEYCRAFT_MAX_RUN_TOKENS` | 600000 | Token limit per job (cache reads count one tenth) |
| `MONKEYCRAFT_MAX_FAMILY_USD` / `_TOKENS` | 5 / 2000000 | Limits for a job and its crew together |
| `MONKEYCRAFT_DAILY_USD` | 25 | Soft daily limit |

Anything saved in Settings overrides these.

## For developers

`npm test` runs the test suite, and `npm run check` checks the syntax of every file. The plan and the design decisions are in `PLAN.md`; `CLAUDE.md` has the rules for working on the code.
