// Merge a custom exercise into another exercise (fork OG-025). Every logged set, routine slot
// and per-exercise setting that pointed at the custom one points at the target instead, and the
// custom exercise goes. Built for history imported as custom exercises that the catalogue
// already has ("bulgarian split squat" made by a CSV import, merged into the library's own).
//
// Per-exercise settings keyed by id (exWeights, exNotes, barWeights, loadKind, dbLoad) keep the
// target's when it has one: what you set up on the real exercise outranks an import's guess.
// Personal records for the target are rebuilt over the combined history (rebuildPrHistory), so
// a badge the merged sets now beat is taken away; none is invented.
import { rebuildPrHistory } from './workout-date.js'
import { stampWorkout } from './sync-merge.js'
import { isCustomEx } from './exercises.js'
import { modeOf } from './history.js'
import { matchName } from './anatoly-match.js'

const KEYED = ['exWeights', 'exNotes', 'barWeights', 'loadKind', 'dbLoad']

// Imported names are often plural ("Lat Pulldowns", "Hip Thrusts") where the library and its
// alias table are singular, so each word loses a plural s before matching ("press" keeps its).
const singular = name => String(name || '').toLowerCase().split(/\s+/)
  .map(w => (w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w)).join(' ')

/** Up to `k` library exercise ids whose names look like `name`, the closest first (OG-012's matcher). */
export function mergeSuggestions(name, k = 4) {
  const ids = [...matchName(singular(name)).candidates, ...matchName(name).candidates].map(c => c.id)
  return [...new Set(ids)].slice(0, k)
}

/** How many logged sessions and routine slots use `id`: shown before a merge. */
export function exerciseUsage(state, id) {
  const workouts = (state.workouts || []).filter(w => (w.entries || []).some(e => e.id === id)).length
  const routines = (state.routines || []).reduce((n, r) => n + (r.ex || []).filter(e => e.id === id).length, 0)
  return { workouts, routines }
}

/**
 * Why `fromId` cannot be merged into `toId`, or null when it can. Only a custom exercise is
 * merged away; the two must log the same way (weight and reps, a timed hold, or cardio), since
 * the sets are moved as they are; and not while a workout running now uses it.
 */
export function mergeBlocker(state, from, to) {
  if (!from || !isCustomEx(from)) return 'not-custom'
  if (!to || to.id === from.id) return 'same'
  if (modeOf({ id: from.id }) !== modeOf({ id: to.id })) return 'mode'
  if ((state.active?.entries || []).some(e => e.id === from.id)) return 'active'
  return null
}

/** Mutates `state`: everything that used `fromId` now uses `toId`, and `fromId` is gone. */
export function mergeExercise(state, fromId, toId, now = Date.now()) {
  if (!fromId || !toId || fromId === toId) return state
  let touched = false
  state.workouts = (state.workouts || []).map(w => {
    if (!(w.entries || []).some(e => e.id === fromId)) return w
    touched = true
    const entries = w.entries.map(e => {
      if (e.id !== fromId) return e
      // The name and muscle snapshot described the custom exercise; the target's own apply now.
      const { n, muscleSnapshot, ...rest } = e
      return { ...rest, id: toId }
    })
    const prs = (w.prs || []).map(id => (id === fromId ? toId : id))
    return stampWorkout({ ...w, entries, ...(w.prs ? { prs: [...new Set(prs)] } : {}) }, now)
  })
  if (touched) state.workouts = rebuildPrHistory(state.workouts, [toId])
  for (const r of state.routines || []) {
    if (!(r.ex || []).some(e => e.id === fromId)) continue
    r.ex = r.ex.map(e => (e.id === fromId ? { ...e, id: toId } : e))
  }
  for (const k of KEYED) {
    const m = state[k]
    if (!m || typeof m !== 'object' || !Object.hasOwn(m, fromId)) continue
    if (!Object.hasOwn(m, toId)) m[toId] = m[fromId]
    delete m[fromId]
  }
  if (Array.isArray(state.favEx) && state.favEx.includes(fromId)) {
    state.favEx = [...new Set(state.favEx.map(id => (id === fromId ? toId : id)))]
  }
  state.customEx = (state.customEx || []).filter(c => c?.id !== fromId)
  return state
}
