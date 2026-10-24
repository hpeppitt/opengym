# Architecture: what the fork adds

Upstream's `CLAUDE.md` describes the app. This file describes only the seams the fork introduces.
Every entry names the new file and the single upstream touch point it hangs off.

## Fork build flag (Phase 0)

`lib/fork.js` exports `FORK`, true only when the build sets `VITE_FORK=1`.
`scripts/fork/build-android.sh` sets it; upstream's builds and the test runner do not, so
upstream's own tests see upstream's behaviour unchanged.

- Touch point: one import and one guard line at the top of `checkForUpdate()` in upstream's
  `lib/update.js`. Under the flag the check answers "no update" without calling GitHub, so the
  Settings row never offers upstream's APK (OG-003). Tested in `lib/fork.test.js`.
- Further fork-only behaviour should gate on the same flag rather than add new ones.

## Upstream sync check (Phase 0)

```
weekly cron / dispatch  ->  .github/workflows/fork-upstream-sync.yml  (skips outside hpeppitt/opengym)
  ->  scripts/fork/upstream-sync.sh upstream/main
        current | conflict (merge aborted, files listed) | fail (gate tail) | pass
  ->  push fork/upstream-sync when the merge is clean
  ->  one open issue labelled upstream-sync, body replaced each run, closed when current
```

- No upstream file is touched. The script is runnable by hand in a scratch worktree with any ref.
- The workflow token cannot push commits that change `.github/workflows`; when upstream edits a
  workflow, the issue says to merge locally instead.

## Anatoly import (Phase 1)

```
photos  ->  lib/anatoly-import.js  ->  Gemini vision (pinned model, key from secure storage)
        ->  { sourceText, sets, reps, repsMax, targetWeight, weightUnit, timeSeconds, notes }[]
        ->  lib/anatoly-match.js   ->  upstream matchExercise() + fuzzy score
        ->  exact | fuzzy | unmatched per row, user confirms fuzzy and unmatched
        ->  lib/anatoly-routine.js: one routine per date (anatoly: { date }), pinned via S.dayPlan[iso]
        ->  removed when Plan opens after that date, unless saved with "Keep in routines"
            (anatoly.keep, OG-017, on by default); the logged workout stays in History
```

- The exercise library is 5,600 entries, too many for the prompt. Gemini returns names; matching
  happens on the phone against `lib/exercises.js`. This is the one deliberate departure from
  fit-app's `workoutImageImport.ts`, which put its 80-entry library in the prompt.
- Match states and the confirmation step are fit-app's FIT-120 design, carried over.
- `lib/anatoly-match.js` resolves a name in this order: a custom exercise the user already has
  (by the id an earlier import gave it, or by name), upstream's `matchExercise` from
  `lib/import-csv.js`, then the closest catalogue name by word overlap, which is never exact.
  `resolveRows()` returns the rows with ids plus only the new custom exercises; the caller merges.
- `lib/anatoly-import.js` is pure apart from `importFromImages()`, which takes `fetch` as a
  parameter. Failures are `AnatolyImportError` with a `code` (`no-key`, `auth`, `network`,
  `max-tokens`, `truncated`, `unreadable`, `empty`, and so on) for the sheet to translate.
- Output is an ordinary routine so the upstream workout flow, progression and 1RM all apply.
- The sheet is `components/fork/AnatolyImport.jsx`, hooked into upstream's Plan header by an
  import and one line. It also runs the tidy-up when Plan mounts. A running workout's routine is
  never removed. Photo decoding lives in `components/fork/anatoly-images.js` so tests can swap it.
- The Gemini key (OG-010) lives in `lib/gemini-key.js`, slot `anatoly.geminiKey`, stored through
  upstream's `secureGet`/`secureSet` in `lib/coach-secrets.js`. Its Settings row is
  `components/fork/GeminiKeyRow.jsx`, hooked into upstream's Settings by an import and one line
  under Data & backup, Bring data in. Shown on phone builds only.
- Merging custom exercises (OG-025): `lib/merge-exercise.js` is the pure merge,
  `components/fork/MergeExercises.jsx` the UI. Two one-line hooks: a row under Settings, Bring
  data in, listing every custom exercise with its closest library name (OG-012's matcher), and a
  Merge button on a custom exercise's detail sheet in upstream's `sheets.jsx`.
- Fork UI strings are English only and live in the code as `t()` keys; no locale file carries a
  fork string (OG-016), so upstream's locale files and their tests are untouched.

## Health Connect read (Phase 2)

Upstream's `HealthConnectPlugin.java` is write-only (sessions and weigh-ins out). The fork adds
reads in a separate plugin class so the two never conflict:

```
HealthReadPlugin.java  ->  lib/health-read.js  ->  pure scorers in lib/
  aggregate: Steps, TotalCaloriesBurned, Nutrition      (dedupes Fitbit + phone sensor)
  raw:       SleepSession stages, RestingHeartRate, HeartRate, ExerciseSession
```

- `lib/sleep-score.js`, `lib/vo2max.js`: ports of fit-app's `utils/sleepScore.ts` and the VO2
  calculation, tests translated with them.
- `HealthReadPlugin.java` is registered by one line in upstream's MainActivity; its seven READ
  permissions sit in a marked block of upstream's manifest. Raw reads follow page tokens and pass
  deduplication disabled (see DECISIONS). `lib/health-read.js` wraps it and shapes the results.
- Cardio for VO2 max is Health Connect's real exercise-type codes, not fit-app's table.
- Aggregate, not raw reads, for steps, calories and nutrition. Same reason as fit-app: raw reads
  double-count when Fitbit and the phone both report.

## History migration (Phase 3)

A one-off script reads fit-app's `workout_set_logs` from Firestore and writes openGym's custom
CSV (`workout name,exercise,date,weight kg,reps`, one row per set), loaded through the existing
importer. Lives in `scripts/fork/`, runs once, is not part of the app.
