# Backlog

Item format: `### OG-NNN <title>` then `status:` ready | building | done | blocked, `depends on:`,
the spec, the acceptance gate. Phases in order; within a phase, by id.

## Phase 0: Set up

### OG-001 Fork, kit scaffold, gate
status: done
Fork to `hpeppitt/opengym`, add the kit profile via `docs/fork/`, pin Node 22 and `TZ=UTC`, own
application id. Gate: `bash scripts/fork/check.sh` exits 0.

### OG-002 First APK on the phone
status: building
depends on: JDK 21 (installed from the Temurin tar.gz into ~/Library/Java/JavaVirtualMachines, no sudo)
`bash scripts/fork/build-android.sh --apk` (not `npm run build:mobile`, which needs Xcode), create
the fork's release keystore under `config/` (gitignored, passwords in the password manager),
zipalign, sign, `adb install`. Gate: the unchanged app runs on the phone beside fit-app.
Done 2026-10-12: the script builds `app-release-unsigned.apk` (about 220 MB) with JDK 21 and
the SDK at ~/Library/Android/sdk. Remaining, Harry's hands only: create the keystore and keep
its passwords in the password manager, sign, connect the phone, install. This unblocks the
on-device gates of OG-003, OG-010 and OG-013.

### OG-003 Disable the in-app updater
status: done
`lib/update.js` polls `DuarteSantos8/openGym` releases and offers the APK. With our own id the
install would fail, but the prompt is noise. Make the check a no-op when the build is the fork
(a `VITE_FORK=1` flag or a repo constant), keeping the edit to upstream's file to a guard line.
Gate: unit test that the check resolves to "no update" under the flag.

### OG-004 Scheduled upstream sync check
status: building
depends on: OG-003
`.github/workflows/fork-upstream-sync.yml`, weekly cron plus manual dispatch, runs
`scripts/fork/upstream-sync.sh`: merge `upstream/main` on a throwaway branch, run `check.sh` and
the frontend build on it, push `fork/upstream-sync` when the merge is clean, and report in one
rolling issue labelled `upstream-sync` (closed again once the fork is current). Never touches
`main`. Two changes from the first spec: the gate runs inside the job, because a push or PR made
with the workflow token does not trigger `test.yml`; and the issue links a ready PR rather than
opening one, because the fork does not let Actions create PRs. Upstream's `mirror.yml` already
skips outside upstream's repo, so it needed no change. The script is verified locally against
four probe refs (up to date, clean, conflict, failing test). Remaining gate: once merged, a
manual dispatch opens the issue or reports up to date.

### OG-005 Guard upstream's deploy workflows in the fork
status: done
`pages.yml` and `docker-publish.yml` have no repository guard, so a push to the fork's `main`
would try to deploy upstream's site to the fork's Pages and publish images to
`ghcr.io/hpeppitt`. Add `if: github.repository == 'DuarteSantos8/openGym'` to their jobs, as
`mirror.yml` does, a one-line `[upstream]` hook each. Also confirm Actions run in the fork at
all: no run has appeared yet, which suggests the fork's Actions tab still needs enabling once.
Gate: a push to `main` shows only the fork's own and upstream's test workflows running.
Done 2026-10-12: on the push of #5's merge, Pages, Docker publish and the mirror all skipped.
Actions were already enabled. One Docker publish ran on #4's merge, before the guard landed.

## Phase 1: Anatoly import (P0)

### OG-010 Gemini key in Settings, secure storage
status: building
Reuse the AI Coach own-key path. Gate: key round-trips through secure storage on the phone.
Built: `lib/gemini-key.js` keeps the key in its own secure-storage slot (`anatoly.geminiKey`)
through upstream's `coach-secrets.js` helpers, never shared with the Coach's key.
`components/fork/GeminiKeyRow.jsx` sits under Settings, Data & backup, Bring data in, phone builds
only. Unit tests cover the round trip, trimming, blank keys and isolation from the Coach key.
Remaining: the on-device round trip, which needs OG-002's APK.

### OG-011 Image to prescription: `lib/anatoly-import.js`
status: done
depends on: OG-010
Port fit-app's `services/workoutImageImport.ts` prompt and JSON parse. Input: photos as base64.
Output: `{ sourceText, sets, reps, targetWeight }[]`. Pinned model `gemini-3.5-flash`,
`maxOutputTokens` 8192 (thinking tokens count against it; fit-app FIT-091). Gate: tests on the
parser with fixture responses, including a truncated one.
Done: rows also carry `repsMax` (a range such as 8-10), `weightUnit` (kg, lb or null),
`timeSeconds` and `notes`, so timed holds and ranges survive. Errors carry a stable `code` for
OG-013 to translate. Not yet run against the live API: that needs a key, and happens in OG-013.

### OG-012 Library match with confirmation: `lib/anatoly-match.js`
status: done
depends on: OG-011
`matchExercise` plus a similarity score; exact, fuzzy, unmatched per row; unmatched becomes a
custom exercise as the CSV importer does. Gate: tests for the three states and the threshold.
Done: order is the user's own custom exercise, then upstream's `matchExercise`, then the closest
catalogue name by word overlap (always fuzzy). Each row carries up to three `candidates` for the
review step. Threshold 0.65, not fit-app's 0.6 (see DECISIONS). DB, BB and KB are expanded.
`resolveRows()` turns unmatched or rejected rows into custom exercises with the CSV importer's
shape and id scheme. 17 tests against the real catalogue.

### OG-013 Import sheet and date pin
status: building
depends on: OG-012
Settings or Plan entry: pick photos, review rows, choose a date, save as a routine pinned via
`dayPlan`. Gate: run-and-verify on device with a real Anatoly screenshot.
Built: an Import button in the Plan header (phone builds), `components/fork/AnatolyImport.jsx`.
Pick photos and a day (today or later), Gemini reads them, every fuzzy row must be confirmed or
changed before Save. `lib/anatoly-routine.js` builds the routine, one per day, replaced on
re-import and tidied away when Plan opens after its day has passed. Missing numbers take
upstream's defaults and the exercise note says so. Tests: 15 for the routine logic, 3 for the
sheet end to end. Remaining: the on-device run with a real screenshot, which needs OG-002's APK
and a saved key.

### OG-014 Import feedback: session title and supersets
status: building
depends on: OG-013
Harry's feedback from the first device run. (1) Title an imported session by the main muscle
groups it trains and the date ("Chest & Arms · 14 Oct"): groups ranked by sets, every group with
at least half the busiest one's sets, at most three. (2) Supersets in the photo were lost: the
prompt now asks for a `supersetGroup` per exercise, linked rows become an upstream superset (a
shared `sg`), and the review rows show it. Gate: re-import the same screenshot on the phone and
see the superset and the title. Installed on the phone 2026-10-12, awaiting that check.

### OG-015 Import review: search the whole library for a match
status: building
depends on: OG-014
Harry's feedback: three suggestions plus "new exercise" is not enough. Each review row now has a
"Change exercise" action that opens upstream's own library picker (search, body-part and
equipment filters, "Create your own exercise"), opened on what trains the same muscle as the
current match. A pick counts as reviewing the row. No new strings. Gate: on the phone, search and
pick an exercise for a row, and the saved routine uses it.

## Phase 2: Health Connect stats

### OG-020 `HealthReadPlugin.java` with read permissions
status: building
Aggregate Steps, TotalCaloriesBurned, Nutrition; raw SleepSession, RestingHeartRate, HeartRate,
ExerciseSession. Manifest `READ_*` permissions. Gate: values on device match Health Connect's own.
Built: `HealthReadPlugin.java` (registered in upstream's MainActivity by one line, seven READ
permissions in its manifest) and `lib/health-read.js` (sleep per night, VO2 inputs from cardio
sessions only, `readStats()`). Verified on the phone 2026-10-12 over the WebView debugger: all
seven permissions granted through the app's own dialog; daily steps and calories, sleep with
stages, resting heart rate and exercise sessions with per-session peak heart rate all read,
every record from Fitbit. Remaining: Harry compares the numbers with Health Connect's own.

### OG-021 Pure scorers: `lib/sleep-score.js`, `lib/vo2max.js`
status: done
Port fit-app's `utils/sleepScore.ts` and the VO2 calculation with their tests. Gate: ported tests
pass.
Done: the sleep score is a straight port and its 9 tests are fit-app's, translated, including
the reference-implementation property test. fit-app's VO2 maths lived inside
`fetchCardioBasedVO2Max` beside the native reads and its tests covered only the reads, so the
formula is lifted into a pure `estimateVo2Max()` and pinned by 9 new hand-worked tests.

### OG-022 Stats cards
status: ready
depends on: OG-020, OG-021
Sleep score, steps, calories, VO2 max on upstream's Stats view. Gate: run-and-verify on device.

## Phase 3: Migrate and retire fit-app

### OG-030 Firestore to CSV migration script
status: ready
`scripts/fork/export-fitapp-history.mjs`: read `workout_set_logs` from Firestore, write openGym's
CSV. Gate: row count matches Firestore, import on device shows the history.

### OG-031 Retire fit-app
status: blocked
depends on: OG-013, OG-022, OG-030, two weeks of daily use
Archive the fit-app repo, note in its CLAUDE.md.
