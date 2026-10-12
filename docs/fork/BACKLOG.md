# Backlog

Item format: `### OG-NNN <title>` then `status:` ready | building | done | blocked, `depends on:`,
the spec, the acceptance gate. Phases in order; within a phase, by id.

## Phase 0: Set up

### OG-001 Fork, kit scaffold, gate
status: done
Fork to `hpeppitt/opengym`, add the kit profile via `docs/fork/`, pin Node 22 and `TZ=UTC`, own
application id. Gate: `bash scripts/fork/check.sh` exits 0.

### OG-002 First APK on the phone
status: ready
depends on: JDK 21 installed (`brew install --cask temurin@21`, needs sudo)
`npm run build:mobile`, `./gradlew assembleRelease`, create the fork's release keystore under
`config/` (gitignored, passwords in the password manager), zipalign, sign, `adb install`. Gate:
the unchanged app runs on the phone beside fit-app.

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
status: building
`pages.yml` and `docker-publish.yml` have no repository guard, so a push to the fork's `main`
would try to deploy upstream's site to the fork's Pages and publish images to
`ghcr.io/hpeppitt`. Add `if: github.repository == 'DuarteSantos8/openGym'` to their jobs, as
`mirror.yml` does, a one-line `[upstream]` hook each. Also confirm Actions run in the fork at
all: no run has appeared yet, which suggests the fork's Actions tab still needs enabling once.
Gate: a push to `main` shows only the fork's own and upstream's test workflows running.
Guards added; the gate waits on Actions being enabled in the fork and a push to `main`.

## Phase 1: Anatoly import (P0)

### OG-010 Gemini key in Settings, secure storage
status: ready
Reuse the AI Coach own-key path. Gate: key round-trips through secure storage on the phone.

### OG-011 Image to prescription: `lib/anatoly-import.js`
status: ready
depends on: OG-010
Port fit-app's `services/workoutImageImport.ts` prompt and JSON parse. Input: photos as base64.
Output: `{ sourceText, sets, reps, targetWeight }[]`. Pinned model `gemini-3.5-flash`,
`maxOutputTokens` 8192 (thinking tokens count against it; fit-app FIT-091). Gate: tests on the
parser with fixture responses, including a truncated one.

### OG-012 Library match with confirmation: `lib/anatoly-match.js`
status: ready
depends on: OG-011
`matchExercise` plus a similarity score; exact, fuzzy, unmatched per row; unmatched becomes a
custom exercise as the CSV importer does. Gate: tests for the three states and the threshold.

### OG-013 Import sheet and date pin
status: ready
depends on: OG-012
Settings or Plan entry: pick photos, review rows, choose a date, save as a routine pinned via
`dayPlan`. Gate: run-and-verify on device with a real Anatoly screenshot.

## Phase 2: Health Connect stats

### OG-020 `HealthReadPlugin.java` with read permissions
status: ready
Aggregate Steps, TotalCaloriesBurned, Nutrition; raw SleepSession, RestingHeartRate, HeartRate,
ExerciseSession. Manifest `READ_*` permissions. Gate: values on device match Health Connect's own.

### OG-021 Pure scorers: `lib/sleep-score.js`, `lib/vo2max.js`
status: ready
Port fit-app's `utils/sleepScore.ts` and the VO2 calculation with their tests. Gate: ported tests
pass.

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
