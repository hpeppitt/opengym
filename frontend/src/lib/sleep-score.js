// Sleep score from Health Connect sleep stages (fork OG-021).
// Ported from fit-app's utils/sleepScore.ts (FIT-004) unchanged in behaviour: plain JavaScript,
// no native imports, no I/O. The caller (lib/health-read.js, OG-020) turns SleepSession records
// into per-stage minutes; this only scores them.
//
// Formula (Fitbit-style):
//   Duration (50 pts):     min(50, (totalSleepMins / 480) * 50)
//   Quality (25 pts):      min(25, (deepRemPercent / 50) * 25)
//   Restoration (25 pts):  clamp(25 * (1 - awakePercent * 2.5), 0, 25)
//
// Stage codes (Health Connect SleepSessionRecord.Stage):
//   1 = AWAKE, 2 = SLEEPING (generic), 3 = OUT_OF_BED, 4 = LIGHT, 5 = DEEP, 6 = REM, 7 = AWAKE_IN_BED
//
// A record with no stage breakdown, or the generic SLEEPING stage, is split 58% light, 23% deep,
// 19% REM: fit-app's estimate calibrated against typical Fitbit stage ratios.

const GENERIC_SLEEP_LIGHT_RATIO = 0.58
const GENERIC_SLEEP_DEEP_RATIO = 0.23
const GENERIC_SLEEP_REM_RATIO = 0.19
const TARGET_SLEEP_MINS = 480 // 8 hours

/**
 * records: [{ stages?: [{ stage, durationMins }], totalDurationMins? }], one per SleepSession
 * record (Fitbit often splits a night across several). Returns { sleepScore (0-100, or null when
 * there was no sleep), durationScore, qualityScore, restorationScore, totalSleepMins,
 * totalAwakeMins }.
 */
export function calculateSleepScore(records) {
  let totalDeepMins = 0
  let totalRemMins = 0
  let totalLightMins = 0
  let totalAwakeMins = 0

  for (const record of records) {
    if (record.stages && record.stages.length > 0) {
      for (const stage of record.stages) {
        const durationMins = stage.durationMins
        switch (stage.stage) {
          case 1: // AWAKE
          case 3: // OUT_OF_BED
          case 7: // AWAKE_IN_BED
            totalAwakeMins += durationMins
            break
          case 2: // SLEEPING (generic/undifferentiated sleep)
            totalLightMins += durationMins * GENERIC_SLEEP_LIGHT_RATIO
            totalDeepMins += durationMins * GENERIC_SLEEP_DEEP_RATIO
            totalRemMins += durationMins * GENERIC_SLEEP_REM_RATIO
            break
          case 4: // LIGHT
            totalLightMins += durationMins
            break
          case 5: // DEEP
            totalDeepMins += durationMins
            break
          case 6: // REM
            totalRemMins += durationMins
            break
          default:
            totalLightMins += durationMins
            break
        }
      }
    } else {
      // No stage data: the whole duration is generic sleep.
      const durationMins = record.totalDurationMins ?? 0
      totalLightMins += durationMins * GENERIC_SLEEP_LIGHT_RATIO
      totalDeepMins += durationMins * GENERIC_SLEEP_DEEP_RATIO
      totalRemMins += durationMins * GENERIC_SLEEP_REM_RATIO
    }
  }

  const totalSleepMins = totalDeepMins + totalRemMins + totalLightMins
  const totalTimeInBed = totalSleepMins + totalAwakeMins

  if (totalSleepMins <= 0) {
    return { sleepScore: null, durationScore: 0, qualityScore: 0, restorationScore: 0, totalSleepMins, totalAwakeMins }
  }

  // 1. Duration (50 points max)
  const durationScore = Math.min(50, (totalSleepMins / TARGET_SLEEP_MINS) * 50)
  // 2. Quality (25 points max): target 50% deep + REM
  const qualityPercent = ((totalDeepMins + totalRemMins) / totalSleepMins) * 100
  const qualityScore = Math.min(25, (qualityPercent / 50) * 25)
  // 3. Restoration (25 points max): penalise time awake
  const awakePercentage = totalTimeInBed > 0 ? totalAwakeMins / totalTimeInBed : 0
  const restorationScore = Math.max(0, Math.min(25, 25 * (1 - awakePercentage * 2.5)))

  const totalScore = Math.round(durationScore + qualityScore + restorationScore)
  return { sleepScore: Math.max(0, Math.min(100, totalScore)), durationScore, qualityScore, restorationScore, totalSleepMins, totalAwakeMins }
}
