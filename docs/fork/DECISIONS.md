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
- The import detects a cut-off Gemini answer by counting brace depth outside strings, not by
  fit-app's "no closing brace anywhere" test (OG-011). An answer usually runs out after a few
  complete exercises, so fit-app's check reported real truncation as malformed JSON. Rows also
  keep rep ranges, the weight unit, durations and notes, which fit-app's rows did not.
- The import's exact-match threshold is 0.65, above fit-app's 0.6 (OG-012). Against the real
  catalogue, "Barbell back squat" scored exactly 0.6 against upstream's pick, a camera-angle
  variant ("barbell full squat (back pov)"), and was accepted without asking. A fuzzy row costs
  one tap to confirm; a wrong exact row files history under the wrong lift.
- Imported Anatoly sessions are kept as one routine per date, replaced if that date is
  imported again, and removed once the date has passed (Harry's call, OG-013). The routine list
  never fills up, and History keeps every logged set. The import starts from a button in the
  Plan header, where routines and the schedule live (Harry's call). Numbers the photo did not
  show take upstream's defaults, and the exercise note names them, because a routine cannot
  hold a null.
- The VO2 max estimate is fit-app's arithmetic lifted out of its Health Connect read function
  into a pure `estimateVo2Max()` that takes the readings as input (OG-021). fit-app's tests for
  that function covered only the reads, so the formula got new tests worked by hand rather than
  translated ones.
- An imported session is titled by its main muscle groups and the date (Harry's feedback,
  OG-014): body parts are folded into chest, back, shoulders, arms, legs, core, cardio and neck,
  ranked by sets, and every group with at least half the busiest one's sets is named, up to
  three. Upstream's own strings name them; 'Back' alone is upstream's navigation button, so the
  body-part string is used for back.
- Health Connect raw reads pass DEDUPLICATION_STRATEGY_DISABLED (OG-020). connect-client
  1.1.0-alpha12 throws NotImplementedError on Android 14 and later for any other value, including
  its own default, and that Error crashed the app on the first sleep read on the phone. Steps,
  calories and nutrition still deduplicate across sources because they are aggregates. The plugin
  catches Throwable so a library Error rejects the call instead of killing the app.
- Cardio sessions are recognised by Health Connect's real ExerciseSessionRecord codes, read off
  the library with javap (OG-020). fit-app's numeric table is wrong for most entries; it lists 70
  as a stair machine when 70 is strength training, so gym sessions fed fit-app's VO2 max. Noted
  for Harry; fit-app is not changed from here.
