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
import { defaultConfig, cleanupSg, NOTE_MAX } from './history.js'
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

/**
 * A routine from reviewed rows: { id, name, emoji, ex, anatoly: { date } }. Rows the photo
 * showed as one superset (same `supersetGroup`, next to each other) share an `sg` id, the way
 * upstream links a superset; upstream's cleanupSg drops a group left with one member.
 */
export function buildRoutine(rows, { name, date, unit = 'kg' } = {}) {
  const id = uid()
  const kept = (rows || []).filter(r => r.exerciseId)
  const ex = kept.map((r, i) => {
    const { cfg } = exerciseConfig(r, { unit })
    if (r.supersetGroup) cfg.sg = `an-${id}-${r.supersetGroup}-${runStart(kept, i)}`
    return cfg
  })
  cleanupSg(ex)
  return { id, name: String(name || '').trim() || 'Anatoly', emoji: 'figureStrength', anatoly: { date: date || null }, ex }
}
// Where the run of same-group rows containing row i starts, so a label reused further down the
// list makes a second superset rather than joining the first.
const runStart = (rows, i) => { while (i > 0 && rows[i - 1].supersetGroup === rows[i].supersetGroup) i--; return i }

// Body parts folded into the groups a title names; the labels are upstream's own strings.
const GROUP_OF = { chest: 'chest', back: 'back', shoulders: 'shoulders', 'upper arms': 'arms', 'lower arms': 'arms', 'upper legs': 'legs', 'lower legs': 'legs', waist: 'core', cardio: 'cardio', neck: 'neck' }

/**
 * The muscle groups a routine mainly trains, by sets: every group with at least half the sets of
 * the busiest one, at most three, busiest first. `bpOf(id)` is the exercise's body part.
 */
export function mainMuscleGroups(ex, bpOf) {
  const sets = new Map()
  for (const e of ex || []) {
    const g = GROUP_OF[bpOf(e.id)]
    if (g) sets.set(g, (sets.get(g) || 0) + (e.sets || 1))
  }
  const ranked = [...sets].sort((a, b) => b[1] - a[1])
  if (!ranked.length) return []
  return ranked.filter(([, n]) => n >= ranked[0][1] / 2).slice(0, 3).map(([g]) => g)
}

// Routines this import made carry `anatoly: { date }`. One per date: importing the same day
// again replaces it. Once its day has passed it is removed (Harry's choice, OG-013); the workout
// logged from it stays in History, which keeps its own copy of every set. A routine saved with
// "Keep in routines" (`anatoly.keep`, OG-017) is library material: never replaced, never tidied.
const isImported = r => !!(r && r.anatoly && r.anatoly.date) && !r.anatoly.keep
const activeIds = s => new Set([].concat(s.active?.routineIds ?? (s.active?.routineId ? [s.active.routineId] : [])))

/**
 * Save an imported session on a store draft: merge its new custom exercises, replace any routine
 * an earlier import made for the same date, add the routine, and pin it to `iso` via dayPlan.
 * `deleteRoutine` is upstream's, so a replaced routine leaves no pointer behind.
 */
export function saveImportedSession(s, routine, { customEx = [], iso, deleteRoutine, keep = false }) {
  s.customEx = s.customEx || []
  s.routines = s.routines || []
  s.dayPlan = s.dayPlan || {}
  for (const c of customEx) if (!s.customEx.some(x => x.id === c.id)) s.customEx.push(c)
  const live = activeIds(s)
  for (const r of s.routines.filter(r => isImported(r) && r.anatoly.date === iso && !live.has(r.id))) deleteRoutine(s, r.id)
  s.routines.push({ ...routine, anatoly: { ...(routine.anatoly || {}), date: iso, ...(keep ? { keep: true } : {}) } })
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
