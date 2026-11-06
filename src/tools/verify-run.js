// verify.run: run a recognised test or check command, for the Inspector. It is
// shell.exec with a short allowlist: test runners and checkers only, with no
// shell punctuation, so it can't chain or redirect anything. It still asks the
// user first, like every command.

const SAFE = /^[A-Za-z0-9_./:=@,+\- ]*$/;
const ALLOWED = [
  /^npm (test|run [A-Za-z0-9:_-]+)( -- [A-Za-z0-9_./:=@,+\- ]+)?$/, /^npx (vitest|jest|mocha|tsc|eslint|prettier --check)( .*)?$/,
  /^node --(test|check)( .*)?$/, /^(pytest|python3? -m (pytest|unittest))( .*)?$/, /^cargo (test|check|clippy)( .*)?$/,
  /^go (test|vet)( .*)?$/, /^make (test|check)$/, /^(ruff|mypy|flake8|black --check)( .*)?$/
];

export function isVerifyCommand(cmd) {
  const c = String(cmd || '').trim();
  return !!c && SAFE.test(c) && ALLOWED.some(re => re.test(c));
}

export function makeVerifyRun({ shell }) {
  return {
    ...shell,
    name: 'verify.run',
    capability: 'verify',
    description: 'Run a test or check command (npm test, node --test, pytest, cargo test, go test, make test, linters…) and get the result. Other commands are refused. The user is asked first.',
    async assess(args) {
      if (!isVerifyCommand(args.command)) return { error: `"${String(args.command).slice(0, 200)}" isn't a recognised test or check command (and shell punctuation like ; | & $ > isn't allowed). Nothing ran.` };
      const a = await shell.assess(args);
      return a.deny || a.error ? a : { ...a, cacheKey: a.cacheKey.replace(/^shell:/, 'verify:') };
    }
  };
}
