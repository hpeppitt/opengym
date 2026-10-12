// Anatoly program import, step 3: reviewed rows to a routine's exercises (fork OG-013).
//
// Input is resolveRows() output from lib/anatoly-match.js: every row has an exerciseId. Output is
// the routine exercise config upstream's editor and workout flow read ({ id, sets, reps,
// repsMin, weight, mode, sec, note }), so progression, 1RM and history all apply unchanged.
//
// A routine needs numbers where the photo may have shown none. fit-app's rule was never to
// invent them; a plan here cannot hold a null, so the gap is filled with upstream's own
// defaultConfig() and the exercise note says which numbers were not in the photo. Nothing is
// filled silently.
import { defaultConfig, NOTE_MAX } from './history.js'
import { isCardio } from './exercises.js'
import { LB_TO_KG } from './recovery.js'
import { uid } from './format.js'

const roundTo = (v, step) => Math.round(v / step) * step

/** A weight in the photo's unit, in the profile's unit: kg to the nearest 0.5, lb to the nearest 1. */
export function toProfileUnit(weight, from, unit) {
  if (weight == null) return null
  if (!from || from === unit) return weight
  return unit === 'lb' ? roundTo(weight / LB_TO_KG, 1) : roundTo(weight * LB_TO_KG, 0.5)
}

/**
 * One reviewed row as a routine exercise config: { cfg, missing }. `missing` names the numbers
 * the photo did not show and a default stands in for: 'sets', 'reps', 'time'.
 */
export function exerciseConfig(row, { unit = 'kg' } = {}) {
  const id = row.exerciseId
  const missing = []
  const base = defaultConfig(id)
  const weight = toProfileUnit(row.targetWeight, row.weightUnit, unit)
  const sets = row.sets ?? (missing.push('sets'), base.sets)
  let cfg
  if (isCardio(id)) {
    cfg = { id, ...base, sets }
  } else if (row.reps == null && (row.timeSeconds != null || /\b(time|max|hold|sec|secs|seconds|min)\b/i.test(row.notes || ''))) {
    const t = defaultConfig(id, 'time')
    cfg = { id, ...t, sets, sec: row.timeSeconds ?? (missing.push('time'), t.sec), weight: weight ?? 0, mode: 'time' }
  } else {
    const top = row.repsMax ?? row.reps
    cfg = { id, ...base, sets, reps: top ?? (missing.push('reps'), base.reps), weight: weight ?? 0, mode: 'reps' }
    if (row.repsMax != null && row.reps != null) cfg.repsMin = row.reps
  }
  const parts = []
  if (row.notes) parts.push(row.notes)
  if (missing.length) parts.push('Not in the photo: ' + missing.join(', '))
  if (parts.length) cfg.note = parts.join(' · ').slice(0, NOTE_MAX)
  return { cfg, missing }
}

/** A routine from reviewed rows: { id, name, emoji, ex, anatoly: { date } }. */
export function buildRoutine(rows, { name, date, unit = 'kg' } = {}) {
  return {
    id: uid(),
    name: String(name || '').trim() || 'Anatoly',
    emoji: 'figureStrength',
    anatoly: { date: date || null },
    ex: (rows || []).filter(r => r.exerciseId).map(r => exerciseConfig(r, { unit }).cfg),
  }
}

// Routines this import made carry `anatoly: { date }`. One per date: importing the same day
// again replaces it. Once its day has passed it is removed (Harry's choice, OG-013); the workout
// logged from it stays in History, which keeps its own copy of every set.
const isImported = r => !!(r && r.anatoly && r.anatoly.date)
const activeIds = s => new Set([].concat(s.active?.routineIds ?? (s.active?.routineId ? [s.active.routineId] : [])))

/**
 * Save an imported session on a store draft: merge its new custom exercises, replace any routine
 * an earlier import made for the same date, add the routine, and pin it to `iso` via dayPlan.
 * `deleteRoutine` is upstream's, so a replaced routine leaves no pointer behind.
 */
export function saveImportedSession(s, routine, { customEx = [], iso, deleteRoutine }) {
  s.customEx = s.customEx || []
  s.routines = s.routines || []
  s.dayPlan = s.dayPlan || {}
  for (const c of customEx) if (!s.customEx.some(x => x.id === c.id)) s.customEx.push(c)
  const live = activeIds(s)
  for (const r of s.routines.filter(r => isImported(r) && r.anatoly.date === iso && !live.has(r.id))) deleteRoutine(s, r.id)
  s.routines.push({ ...routine, anatoly: { ...(routine.anatoly || {}), date: iso } })
  s.dayPlan[iso] = routine.id
  return routine.id
}

/** The imported routines whose day is before `today`, except one a running workout uses. */
export function staleImportedRoutines(S, today) {
  const live = activeIds(S)
  return (S.routines || []).filter(r => isImported(r) && r.anatoly.date < today && !live.has(r.id)).map(r => r.id)
}

/** Remove stale imported routines on a store draft. Returns how many went. */
export function tidyImportedRoutines(s, today, deleteRoutine) {
  const ids = staleImportedRoutines(s, today)
  ids.forEach(id => deleteRoutine(s, id))
  return ids.length
}
