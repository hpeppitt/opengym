# Decisions

Dated, append-only. One entry per decision that changes direction.

## 2026-10-12
- Forked openGym at v1.4.1 (`464355ef`) as `hpeppitt/opengym` rather than porting its features
  into fit-app. The stacks do not match (React Native/TypeScript versus React/Vite/Capacitor in
  plain JS), openGym is about 94k lines ahead on logging, and AGPL-3.0 would otherwise attach to
  fit-app. fit-app stays untouched until this fork reaches parity.
- Local-only on the phone to start, with openGym's auto-backup. No self-hosted server, no
  Firebase. Revisit when a second device matters.
- Phase 2 scope is stats (sleep score, steps, calories, VO2 max), not fit-app's six daily goals,
  Week Matrix or home-screen widget.
- Upstream is tracked with `git merge upstream/main`, never rebase. Fork code lives in new files;
  upstream files get one-line hooks (`@docs/fork/FORK.md` in CLAUDE.md, `apply from: 'fork.gradle'`
  in build.gradle).
- Own application id `com.hpeppitt.opengym` via `fork.gradle`, so the app installs beside
  upstream's and beside fit-app, and the in-app updater (`lib/update.js`, pinned to upstream's
  GitHub releases) can never install upstream's differently-signed APK over it. The updater still
  needs disabling in the fork: OG-003.
- Gemini key for the Anatoly import is entered in Settings and held in the phone's secure
  storage, reusing the AI Coach's own-key path. Not baked at build time as fit-app did (FIT-074).
- Gate pinned to Node 22 and `TZ=UTC`, matching upstream CI, after the baseline run on Node 25 in
  Sydney time showed 565 then 7 spurious failures.
- fit-app history migrates from Firestore (the durable archive) into openGym's CSV import, not
  from the phone's SQLite, which release builds cannot read via `run-as`.
- The in-app updater is disabled by a build-time `VITE_FORK=1` flag (`lib/fork.js`), not a
  constant that is always on. A constant would have failed upstream's own updater tests unless
  the fork edited their test file too; the flag keeps the upstream touch to two lines in
  `lib/update.js`. The flag is set in `scripts/fork/build-android.sh` (OG-003).
- The weekly upstream check reports in a rolling issue and runs the gate inside its own job
  (OG-004). A PR opened or a branch pushed with the workflow token would not trigger
  `test.yml`, and the fork does not allow Actions to open PRs; a personal token would fix both
  but is a secret to rotate for no real gain. The issue carries a one-click link to open the PR.
- The Gemini key for the import has its own secure-storage slot, separate from the AI Coach's
  own key, even though the Coach can also run on Gemini (Harry's call, OG-010). The import then
  works whatever the Coach is set to, and the fork's code stays out of upstream's Coach code. The
  cost is entering the key twice if the Coach is also used on Gemini.
