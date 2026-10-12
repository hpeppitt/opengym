import { describe, it, expect } from 'vitest'
import { estimateVo2Max, agePredictedMaxHR, ageFactor } from './vo2max.js'

// fit-app's own VO2 tests exercised the Health Connect read plumbing; the formula had none. These
// pin the arithmetic fetchCardioBasedVO2Max did, case by case, with the numbers worked by hand.

describe('agePredictedMaxHR (Tanaka)', () => {
  it('is 208 - 0.7 x age, unrounded', () => {
    expect(agePredictedMaxHR(30)).toBe(187)
    expect(agePredictedMaxHR(34)).toBeCloseTo(184.2)
  })
})

describe('ageFactor', () => {
  it('is 1 up to 25, then 0.7% less per year, floored at 0.70', () => {
    expect(ageFactor(20)).toBe(1)
    expect(ageFactor(25)).toBe(1)
    expect(ageFactor(35)).toBeCloseTo(0.93)
    expect(ageFactor(68)).toBeCloseTo(0.70)  // 1 - 0.301 = 0.699, floored
    expect(ageFactor(90)).toBe(0.70)
  })
})

describe('estimateVo2Max', () => {
  it('uses the highest cardio-session heart rate when there is one (cardio-based)', () => {
    // 15.3 x 190 / 60 = 48.45; age 35 factor 0.93 -> 45.0585 -> 45.1
    expect(estimateVo2Max({ age: 35, restingHrSamples: [58, 62], cardioSessionMaxHrs: [172, 190, 181] }))
      .toEqual({ vo2Max: 45.1, restingHR: 60, maxHR: 190, cardioMaxHR: 190, method: 'cardio-based' })
  })

  it('falls back to the age-predicted max, rounded, with no cardio sessions', () => {
    // max 187; 15.3 x 187 / 55 = 52.02; age 30 factor 0.965 -> 50.2
    expect(estimateVo2Max({ age: 30, restingHrSamples: [55] }))
      .toEqual({ vo2Max: 50.2, restingHR: 55, maxHR: 187, cardioMaxHR: null, method: 'age-predicted' })
  })

  it('averages resting HR and rounds it, as fit-app did (50 and 60 -> 55)', () => {
    expect(estimateVo2Max({ age: 30, restingHrSamples: [50, 60] }).restingHR).toBe(55)
    expect(estimateVo2Max({ age: 30, restingHrSamples: [50, 51] }).restingHR).toBe(51)
  })

  it('uses the manual resting HR only when there are no readings', () => {
    expect(estimateVo2Max({ age: 30, restingHrSamples: [], restingHrOverride: 52 }).restingHR).toBe(52)
    expect(estimateVo2Max({ age: 30, restingHrSamples: [60], restingHrOverride: 52 }).restingHR).toBe(60)
  })

  it('gives no estimate without a resting HR rather than a confident wrong one', () => {
    expect(estimateVo2Max({ age: 30, cardioSessionMaxHrs: [190] })).toMatchObject({ vo2Max: null, restingHR: null, maxHR: 190 })
    expect(estimateVo2Max({ age: 30, restingHrOverride: 0 }).vo2Max).toBe(null)
  })

  it('ignores zero, negative and missing readings', () => {
    const r = estimateVo2Max({ age: 25, restingHrSamples: [0, null, 60, 'x', -5], cardioSessionMaxHrs: [0, undefined] })
    expect(r).toMatchObject({ restingHR: 60, cardioMaxHR: null, method: 'age-predicted', maxHR: 191 })
    // 15.3 x 191 / 60 = 48.705, factor 1 -> 48.7
    expect(r.vo2Max).toBe(48.7)
  })

  it('applies the floor for an older user', () => {
    // max round(208 - 49) = 159; 15.3 x 159 / 60 = 40.545; factor 0.70 -> 28.38 -> 28.4
    expect(estimateVo2Max({ age: 70, restingHrSamples: [60] }).vo2Max).toBe(28.4)
  })
})
