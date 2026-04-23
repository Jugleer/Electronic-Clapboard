# /commit — Audit, test, and commit to GitHub

Perform the following steps in order. Stop and report if any step fails.

## 1. Pre-flight checks
- Confirm we are on a feature branch or `main`. If on a detached HEAD, stop and explain.
- Run `git status` and `git diff --cached` to see what's staged. If nothing is staged, check unstaged changes and ask what to include.

## 2. Code audit (same as /audit but blocking)
- Review all changed files for:
  - **Safety**: MOSFET gate pins default LOW, solenoid pulse has max-duration guard, battery check before sync
  - **Style**: snake_case, named constants, no magic numbers, no blocking delays in loop()
  - **Correctness**: logic errors, off-by-one, unsigned overflow, missing null checks
  - **Hardware consistency**: pin numbers match `config.h`, voltage thresholds make physical sense
- If any safety issue is found, **stop the commit** and explain the issue. Do not proceed.
- Report all findings before continuing.

## 3. Build
- Run `pio run` to confirm the project compiles without errors or warnings.
- If there are warnings, assess whether they are benign or indicative of bugs. Report them.

## 4. Tests
- Run `pio test -e native` (or the appropriate test environment) for unit tests.
- All tests must pass. If any fail, stop and report.

## 5. Compose commit message
- Use conventional commit format: `type: short description`
- Types: `feat`, `fix`, `refactor`, `docs`, `test`, `hw`
- Include a body if the change is non-trivial, explaining *why* not just *what*
- Present the proposed commit message for approval before executing.

## 6. Commit and push
- Stage the agreed files: `git add <files>`
- Commit: `git commit -m "<message>"`
- Push: `git push origin <current-branch>`
- Confirm success.

If any step fails, explain clearly what went wrong, suggest a fix, and do not proceed to later steps.
