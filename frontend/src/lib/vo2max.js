// VO2 max estimate from heart rate (fork OG-021).
//
// Ported from fit-app's fetchCardioBasedVO2Max (services/healthConnect.ts, FIT-137) with the
// Health Connect reads lifted out: lib/health-read.js (OG-020) gathers the readings, this only
// does the arithmetic. Behaviour is fit-app's:
//   resting HR  = the 30-day average of RestingHeartRate readings, rounded, or the manual value
//                 when there are none
//   max HR      = the highest heart rate seen during a cardio session in 30 days
//                 ('cardio-based'), else Tanaka's age prediction, 208 - 0.7 * age, rounded
//                 ('age-predicted')
//   VO2 max     = Uth: 15.3 * maxHR / restingHR, times an age factor of 1 - 0.007 per year
//                 over 25, floored at 0.70; rounded to one decimal
// No resting HR means no estimate: a confidently wrong number is worse than none (fit-app).

/** Tanaka's age-predicted maximum heart rate, unrounded (fit-app utils/progression.ts). */
export const agePredictedMaxHR = age => 208 - 0.7 * age

/** The age correction: 1 up to 25, then 0.7% less per year, never below 0.70. */
export const ageFactor = age => (age > 25 ? Math.max(0.70, 1 - 0.007 * (age - 25)) : 1.0)

/**
 * { age, restingHrSamples: number[], cardioSessionMaxHrs: number[], restingHrOverride? } ->
 * { vo2Max, restingHR, maxHR, cardioMaxHR, method }. `method` is 'cardio-based' or
 * 'age-predicted' (which max HR was used); `vo2Max` is null when there is no resting HR.
 * Zero, negative and non-numeric readings are ignored, as fit-app's `if (bpm)` did.
 */
export function estimateVo2Max({ age, restingHrSamples = [], cardioSessionMaxHrs = [], restingHrOverride = null }) {
  const valid = xs => xs.map(Number).filter(n => Number.isFinite(n) && n > 0)

  const rest = valid(restingHrSamples)
  let restingHR = rest.length ? Math.round(rest.reduce((a, b) => a + b, 0) / rest.length) : null
  if (!restingHR && restingHrOverride > 0) restingHR = restingHrOverride

  const peaks = valid(cardioSessionMaxHrs)
  const cardioMaxHR = peaks.length ? Math.max(...peaks) : null
  const method = cardioMaxHR ? 'cardio-based' : 'age-predicted'
  const maxHR = cardioMaxHR || Math.round(agePredictedMaxHR(age))

  const vo2Max = restingHR && maxHR ? Math.round(15.3 * (maxHR / restingHR) * ageFactor(age) * 10) / 10 : null
  return { vo2Max, restingHR, maxHR, cardioMaxHR, method }
}
