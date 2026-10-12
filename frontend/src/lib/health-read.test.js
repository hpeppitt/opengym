import { describe, it, expect, vi, beforeEach } from 'vitest'

// The native plugin, faked: each method answers from `answers`, or rejects with a permission error.
const answers = {}
const plugin = new Proxy({}, { get: (_, m) => (m === 'then' ? undefined : vi.fn(async args => {
  const a = answers[m]
  if (a instanceof Error) throw a
  return typeof a === 'function' ? a(args) : a
})) })
vi.mock('@capacitor/core', () => ({ registerPlugin: () => plugin }))

const { isCardioSession, sleepByNight, vo2FromReadings, localDate, readStats, CARDIO_TYPES } = await import('./health-read.js')
const { calculateSleepScore } = await import('./sleep-score.js')

const H = 3600000
const at = (iso) => Date.parse(iso)   // the gate runs with TZ=UTC, so local dates are UTC dates

describe('isCardioSession (Health Connect\'s real type codes)', () => {
  it('counts running, walking, cycling and the machines as cardio', () => {
    for (const type of [56, 57, 79, 8, 9, 25, 54, 69, 74]) expect(isCardioSession({ type })).toBe(true)
  })
  it('never counts strength training (70) or weightlifting (81), which fit-app\'s table got wrong', () => {
    expect(isCardioSession({ type: 70 })).toBe(false)
    expect(isCardioSession({ type: 81 })).toBe(false)
    expect(isCardioSession({ type: 81, title: 'Rowing day' })).toBe(false)
  })
  it('falls back to the title for a generic session', () => {
    expect(isCardioSession({ type: 0, title: 'Morning run' })).toBe(true)
    expect(isCardioSession({ type: 0, title: 'Upper body' })).toBe(false)
    expect(isCardioSession({})).toBe(false)
  })
  it('lists exactly the documented codes', () => {
    expect([...CARDIO_TYPES].sort((a, b) => a - b)).toEqual([8, 9, 16, 25, 36, 37, 53, 54, 56, 57, 60, 61, 68, 69, 73, 74, 79, 82])
  })
})

describe('sleepByNight', () => {
  it('scores a staged night by the date it ended, with stage minutes from the timestamps', () => {
    const start = at('2026-10-11T22:00:00Z')
    const night = { start, end: start + 8 * H, stages: [
      { stage: 4, start, end: start + 4 * H },            // light 240
      { stage: 5, start: start + 4 * H, end: start + 6 * H }, // deep 120
      { stage: 6, start: start + 6 * H, end: start + 7.5 * H }, // REM 90
      { stage: 1, start: start + 7.5 * H, end: start + 8 * H }, // awake 30
    ] }
    const [n] = sleepByNight([night])
    expect(n.date).toBe('2026-10-12')
    expect(n).toMatchObject(calculateSleepScore([{ stages: [
      { stage: 4, durationMins: 240 }, { stage: 5, durationMins: 120 }, { stage: 6, durationMins: 90 }, { stage: 1, durationMins: 30 },
    ] }]))
  })

  it('joins a night split across records, and scores an unstaged one as generic sleep', () => {
    const a = { start: at('2026-10-11T23:00:00Z'), end: at('2026-10-12T02:00:00Z'), stages: [] }
    const b = { start: at('2026-10-12T02:30:00Z'), end: at('2026-10-12T07:00:00Z'), stages: [] }
    const nights = sleepByNight([b, a])
    expect(nights).toHaveLength(1)
    expect(nights[0].totalSleepMins).toBeCloseTo(180 + 270)
  })

  it('keeps nights apart and in date order, and skips broken records', () => {
    const n1 = { start: at('2026-10-10T23:00:00Z'), end: at('2026-10-11T07:00:00Z') }
    const n2 = { start: at('2026-10-11T23:00:00Z'), end: at('2026-10-12T06:00:00Z') }
    expect(sleepByNight([n2, { start: 5, end: 5 }, n1, null]).map(n => n.date)).toEqual(['2026-10-11', '2026-10-12'])
  })
})

describe('vo2FromReadings', () => {
  it('uses only cardio sessions for the max heart rate', () => {
    const r = vo2FromReadings({ age: 35, resting: [{ bpm: 58 }, { bpm: 62 }], sessions: [
      { type: 56, maxHr: 182 }, { type: 70, maxHr: 195 }, { type: 0, title: 'Upper', maxHr: 199 }, { type: 79, maxHr: null },
    ] })
    expect(r).toMatchObject({ restingHR: 60, cardioMaxHR: 182, method: 'cardio-based' })
  })
})

describe('readStats', () => {
  beforeEach(() => { for (const k of Object.keys(answers)) delete answers[k] })
  const now = at('2026-10-12T09:00:00Z')

  it('one row per day ending today, with that night\'s sleep, and a VO2 estimate', async () => {
    answers.daily = ({ from, to }) => {
      expect([from, to]).toEqual(['2026-10-10', '2026-10-12'])
      return { days: [{ date: '2026-10-11', steps: 9000, kcalBurned: 2600, kcalEaten: 2100, proteinG: 150 }, { date: '2026-10-12', steps: 4000, kcalBurned: null, kcalEaten: null, proteinG: null }] }
    }
    answers.sleep = { sessions: [{ start: at('2026-10-11T22:30:00Z'), end: at('2026-10-12T06:30:00Z') }] }
    answers.restingHeartRate = { readings: [{ time: now, bpm: 55 }] }
    answers.exerciseSessions = { sessions: [{ type: 56, maxHr: 185 }] }
    const r = await readStats({ days: 3, age: 30, now })
    expect(r.days.map(d => d.date)).toEqual(['2026-10-10', '2026-10-11', '2026-10-12'])
    expect(r.days[0]).toEqual({ date: '2026-10-10', steps: null, kcalBurned: null, kcalEaten: null, proteinG: null, sleepScore: null, sleepMins: null })
    expect(r.days[1]).toMatchObject({ steps: 9000, kcalEaten: 2100, proteinG: 150, sleepScore: null })
    expect(r.days[2].sleepScore).toBeGreaterThan(0)
    expect(r.days[2].sleepMins).toBe(480)
    expect(r.vo2).toMatchObject({ restingHR: 55, cardioMaxHR: 185 })
  })

  it('a kind of data not granted comes back null without failing the rest', async () => {
    const denied = Object.assign(new Error('no'), { code: 'permission' })
    answers.daily = { days: [{ date: '2026-10-12', steps: 100 }] }
    answers.sleep = denied
    answers.restingHeartRate = denied
    answers.exerciseSessions = denied
    const r = await readStats({ days: 1, age: 30, now })
    expect(r.days[0]).toMatchObject({ steps: 100, sleepScore: null })
    expect(r.vo2).toBe(null)
  })

  it('a real failure still fails', async () => {
    answers.daily = new Error('boom')
    answers.sleep = { sessions: [] }; answers.restingHeartRate = { readings: [] }; answers.exerciseSessions = { sessions: [] }
    await expect(readStats({ days: 1, age: 30, now })).rejects.toThrow('boom')
  })

  it('local dates follow the phone\'s calendar', () => {
    expect(localDate(at('2026-10-12T23:59:59Z'))).toBe('2026-10-12')
  })
})

import { summarizeStats, ageFrom } from './health-read.js'

describe('summarizeStats (Home card)', () => {
  const day = (date, o = {}) => ({ date, steps: null, kcalBurned: null, kcalEaten: null, proteinG: null, sleepScore: null, sleepMins: null, ...o })
  it('shows today and averages the earlier days, skipping gaps', () => {
    const s = summarizeStats({ days: [
      day('2026-10-10', { steps: 8000, kcalBurned: 2500, sleepScore: 70 }),
      day('2026-10-11', { steps: 10000, kcalBurned: null, sleepScore: 90 }),
      day('2026-10-12', { steps: 2000, kcalBurned: 1800, kcalEaten: 1200, sleepScore: 82, sleepMins: 466 }),
    ], vo2: { vo2Max: 47.2 } })
    expect(s.sleep).toEqual({ score: 82, mins: 466, avg: 80 })
    expect(s.steps).toEqual({ today: 2000, avg: 9000 })
    expect(s.calories).toEqual({ burned: 1800, eaten: 1200, avg: 2500 })
    expect(s.vo2).toEqual({ vo2Max: 47.2 })
  })
  it('copes with nothing at all', () => {
    expect(summarizeStats(null)).toEqual({ sleep: { score: null, mins: null, avg: null }, steps: { today: null, avg: null }, calories: { burned: null, eaten: null, avg: null }, vo2: null })
  })
})

describe('ageFrom', () => {
  const now = new Date('2026-10-12T00:00:00Z')
  it('turns a plausible birth year into an age, and refuses the rest', () => {
    expect(ageFrom(1990, now)).toBe(36)
    expect(ageFrom('1990', now)).toBe(36)
    expect(ageFrom(2020, now)).toBe(null)
    expect(ageFrom(1900, now)).toBe(null)
    expect(ageFrom(undefined, now)).toBe(null)
    expect(ageFrom('19x0', now)).toBe(null)
  })
})
