// Health Connect reads for the fork's stats (OG-020): the JS side of HealthReadPlugin.java.
//
// The plugin hands back raw shapes; the pure helpers here turn them into what the stats need,
// using the scorers from OG-021. Only readStats() and the wrappers touch the native side.
import { calculateSleepScore } from './sleep-score.js'
import { estimateVo2Max } from './vo2max.js'

// Cardio exercise types, from Health Connect's own ExerciseSessionRecord constants (read off
// connect-client 1.1.0-alpha12 with javap). fit-app's table had the wrong numbers for most of
// these; among others it counted 70 (strength training) as a stair machine, so gym sessions fed
// its VO2 max. Biking 8, stationary 9, dancing 16, elliptical 25, HIIT 36, hiking 37, rowing 53,
// rowing machine 54, running 56, treadmill 57, skating 60, skiing 61, stairs 68, stair machine 69,
// open-water swim 73, pool swim 74, walking 79, wheelchair 82.
export const CARDIO_TYPES = new Set([8, 9, 16, 25, 36, 37, 53, 54, 56, 57, 60, 61, 68, 69, 73, 74, 79, 82])
// A session some app filed as "other" but titled for what it was (fit-app's fallback).
const CARDIO_WORDS = ['RUN', 'WALK', 'CYCL', 'BIKE', 'SWIM', 'ROW', 'ELLIPTICAL', 'STAIR', 'HIKE', 'HIKING', 'DANC', 'SKAT', 'SKI', 'HIIT']
const STRENGTH_TYPES = new Set([13, 70, 81]) // calisthenics, strength training, weightlifting

export function isCardioSession(s) {
  const type = Number(s?.type)
  if (CARDIO_TYPES.has(type)) return true
  if (STRENGTH_TYPES.has(type)) return false
  const title = String(s?.title || '').toUpperCase()
  return CARDIO_WORDS.some(w => title.includes(w))
}

const pad = n => String(n).padStart(2, '0')
/** The phone's local calendar date of an instant, as YYYY-MM-DD. */
export const localDate = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const mins = (a, b) => Math.max(0, (b - a) / 60000)

/**
 * Sleep sessions to one score per night, oldest first. A night is the local date its sleep ended
 * on (the morning you woke), so a Fitbit night split across several records scores as one.
 */
export function sleepByNight(sessions) {
  const nights = new Map()
  for (const s of sessions || []) {
    if (!(s?.end > s?.start)) continue
    const date = localDate(s.end)
    const stages = (s.stages || []).filter(x => x?.end > x?.start).map(x => ({ stage: x.stage, durationMins: mins(x.start, x.end) }))
    const record = stages.length ? { stages } : { totalDurationMins: mins(s.start, s.end) }
    if (!nights.has(date)) nights.set(date, [])
    nights.get(date).push(record)
  }
  return [...nights.keys()].sort().map(date => ({ date, ...calculateSleepScore(nights.get(date)) }))
}

/** VO2 max from 30 days of resting heart rate and exercise sessions (fit-app's method). */
export function vo2FromReadings({ age, resting = [], sessions = [], restingHrOverride = null }) {
  return estimateVo2Max({
    age,
    restingHrSamples: resting.map(r => r?.bpm),
    cardioSessionMaxHrs: sessions.filter(isCardioSession).map(s => s?.maxHr),
    restingHrOverride,
  })
}

// The native plugin, loaded lazily. It travels inside a plain object: Capacitor's registerPlugin
// returns a Proxy that answers `then` too, so a promise resolving to the proxy itself never
// settles (upstream issues #42 and #58; see lib/coach-secrets.js).
let loaded = null
function native() {
  if (!loaded) loaded = import('@capacitor/core').then(m => ({ p: m.registerPlugin('HealthRead') })).catch(() => ({ p: null }))
  return loaded
}
async function call(method, args) {
  const { p } = await native()
  if (!p) throw Object.assign(new Error('Health Connect is not available'), { code: 'unavailable' })
  return p[method](args)
}

export const healthReadStatus = () => call('status')
export const requestHealthRead = () => call('requestPermissions')
export const readDaily = (from, to) => call('daily', { from, to }).then(r => r.days || [])
export const readSleep = (start, end) => call('sleep', { start, end }).then(r => r.sessions || [])
export const readRestingHr = (start, end) => call('restingHeartRate', { start, end }).then(r => r.readings || [])
export const readExerciseSessions = (start, end) => call('exerciseSessions', { start, end }).then(r => r.sessions || [])

const DAY = 86400000

/**
 * Everything the stats cards show, for the last `days` days ending today: one row per day with
 * steps, calories burned and eaten, protein and that night's sleep score, plus a 30-day VO2 max.
 * A kind of data the user did not grant comes back null rather than failing the rest.
 */
export async function readStats({ days = 7, age, restingHrOverride = null, now = Date.now() } = {}) {
  const today = localDate(now)
  const from = localDate(now - (days - 1) * DAY)
  const month = now - 30 * DAY
  const safe = p => p.catch(e => (e?.code === 'permission' ? null : Promise.reject(e)))
  const [daily, sleep, resting, sessions] = await Promise.all([
    safe(readDaily(from, today)),
    safe(readSleep(now - (days + 1) * DAY, now)),
    safe(readRestingHr(month, now)),
    safe(readExerciseSessions(month, now)),
  ])
  const nights = new Map((sleep ? sleepByNight(sleep) : []).map(n => [n.date, n]))
  const byDate = new Map((daily || []).map(d => [d.date, d]))
  const rows = []
  for (let i = days - 1; i >= 0; i--) {
    const date = localDate(now - i * DAY)
    const d = byDate.get(date) || {}
    const n = nights.get(date)
    rows.push({ date, steps: d.steps ?? null, kcalBurned: d.kcalBurned ?? null, kcalEaten: d.kcalEaten ?? null, proteinG: d.proteinG ?? null, sleepScore: n?.sleepScore ?? null, sleepMins: n?.sleepScore != null ? Math.round(n.totalSleepMins) : null })
  }
  const vo2 = resting === null ? null : vo2FromReadings({ age, resting, sessions: sessions || [], restingHrOverride })
  return { days: rows, vo2 }
}

const avg = xs => { const v = xs.filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }

/**
 * What the Home card shows, from readStats(): today's value per tile and the average of the
 * earlier days that have one (today is still running, so it would drag the average down).
 * Sleep is last night's, the night that ended today.
 */
export function summarizeStats(stats) {
  const rows = stats?.days || []
  const today = rows[rows.length - 1] || {}
  const before = rows.slice(0, -1)
  return {
    sleep: { score: today.sleepScore ?? null, mins: today.sleepMins ?? null, avg: avg(before.map(r => r.sleepScore)) },
    steps: { today: today.steps ?? null, avg: avg(before.map(r => r.steps)) },
    calories: { burned: today.kcalBurned ?? null, eaten: today.kcalEaten ?? null, avg: avg(before.map(r => r.kcalBurned)) },
    vo2: stats?.vo2 ?? null,
  }
}

/** Age in whole years from a birth year, or null when there is none worth trusting. */
export function ageFrom(birthYear, now = new Date()) {
  const y = Number(birthYear)
  const age = now.getFullYear() - y
  return Number.isInteger(y) && age >= 10 && age <= 110 ? age : null
}
