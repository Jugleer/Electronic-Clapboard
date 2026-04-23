# /audit — Review the current codebase or staged changes

Perform a thorough code review. If specific files are mentioned after the command, audit only those. Otherwise, audit all files with uncommitted changes (`git diff` + `git diff --cached`). If there are no uncommitted changes, audit the most recent commit (`git diff HEAD~1`).

## Review checklist

### Safety (blockers — must fix before committing)
- [ ] All MOSFET gate pins are set LOW in `setup()` before any other initialisation
- [ ] Solenoid pulse has a firmware-enforced maximum duration via timer/watchdog, not just a `delay()` + `digitalWrite(LOW)`
- [ ] Battery voltage is checked before firing sync (LED + solenoid)
- [ ] No floating gate scenario: 100kΩ pulldown resistors are documented/assumed for each MOSFET
- [ ] No accidental infinite loops or blocking calls in the main loop that could leave a MOSFET on

### Correctness
- [ ] State machine transitions are complete — every state handles every possible input
- [ ] Voltage divider math matches the physical resistor values in `config.h`
- [ ] ADC readings are averaged/filtered (ESP32 ADC is noisy — single reads are unreliable)
- [ ] Timing values (`SOLENOID_PULSE_MS`, `LED_PULSE_MS`) are within safe hardware limits
- [ ] No unsigned integer underflow (e.g., `millis() - lastTime` when `lastTime` > `millis()` after rollover — use the subtraction pattern, which handles wrapping correctly)

### Style & maintainability
- [ ] Pin numbers and thresholds live in `config.h`, not scattered through source files
- [ ] No magic numbers — all timing/threshold/pin values are named constants with unit suffixes
- [ ] Functions are short and single-purpose
- [ ] Comments explain *why*, not *what* (the code explains what)
- [ ] Conventional commit prefixes used in recent history

### Hardware consistency
- [ ] Pin assignments in code match `CLAUDE.md` and `docs/wiring-guide.md`
- [ ] Any pin reassignment is reflected in all three places (config.h, CLAUDE.md, wiring guide)
- [ ] Voltage thresholds correspond to real-world values (e.g., 3.3V/cell × 3 = 9.9V pack cutoff)

## Output format

Organise findings into:
1. **Blockers** — safety or correctness issues that must be fixed
2. **Warnings** — things that will probably cause problems later
3. **Suggestions** — style, readability, or minor improvements
4. **All clear** — if nothing is found, say so explicitly

Be specific: name the file, line, and what's wrong. Suggest a fix for each finding.
