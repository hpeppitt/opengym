// Anatoly program import, step 2: each row's exercise name against the library (fork OG-012).
//
// Three states per row, fit-app's FIT-120 design carried over:
// - exact: the name resolved, and closely resembles the library name (score >= MATCH_THRESHOLD)
// - fuzzy: something resolved, but the wording differs enough that the user confirms it
//   (fit-app's real case: "Standing low cable row" silently filed as "Seated Cable Row")
// - unmatched: nothing close; the row becomes a custom exercise, as the CSV importer does
//
// Resolution order: a custom exercise the user already has under that name (so a second import
// lands on the same history), then upstream's matchExercise() from lib/import-csv.js (curated
// aliases, exact word sets, a single close candidate), then the closest catalogue name by word
// overlap. Only the last step can be wrong in a way the user would not expect, so a candidate it
// finds is always fuzzy, never exact.
//
// Pure: no state is read or written here. The caller passes S.customEx in and merges what
// resolveRows() returns (OG-013).
import { EXDB, EXIDX, canonicalExId } from './exercises.js'
import { matchExercise, importId, priorCustom, bpFromName } from './import-csv.js'

// fit-app used 0.6 (utils/exerciseMatch.ts): "standing low cable row" vs "seated cable row"
// scores 0.4 and must ask. Here it is 0.65, because exactly 0.6 let "Barbell back squat" through
// as "barbell full squat (back pov)", a camera-angle variant, without asking. A fuzzy row costs
// one tap; a wrong exact row files history under the wrong lift. "Romanian deadlift" against
// "barbell romanian deadlift" scores 0.67 and still passes.
export const MATCH_THRESHOLD = 0.65
// Below this the closest catalogue name is not worth offering: one shared word in three.
export const FUZZY_FLOOR = 0.34

// Gym shorthand a program app writes and the catalogue spells out.
const ABBR = { db: 'dumbbell', dbs: 'dumbbell', dumbell: 'dumbbell', bb: 'barbell', kb: 'kettlebell', ez: 'ez' }
const tokens = s => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).map(w => ABBR[w] || w)

/** Jaccard similarity of the two names' word sets, 0 to 1, ignoring case, punctuation, order. */
export function nameSimilarity(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b))
  if (!A.size && !B.size) return 1
  if (!A.size || !B.size) return 0
  let both = 0
  for (const w of A) if (B.has(w)) both++
  return both / (A.size + B.size - both)
}

const round2 = n => Math.round(n * 100) / 100
const SOURCE = 'Anatoly'
const customId = name => importId('an', SOURCE + '|' + String(name).trim().toLowerCase())

let CATALOGUE_TOKENS = null
const catalogueTokens = () => CATALOGUE_TOKENS || (CATALOGUE_TOKENS = EXDB.map(e => ({ id: e.id, set: new Set(tokens(e.n)) })))

/**
 * The `k` closest catalogue entries by word overlap, best first: [{ id, name, score }], scores
 * above zero only. Equal scores keep catalogue order, so the result is stable.
 */
export function closestExercises(name, k = 3) {
  const q = new Set(tokens(name))
  if (!q.size) return []
  const scored = []
  for (const c of catalogueTokens()) {
    let both = 0
    for (const w of q) if (c.set.has(w)) both++
    if (both) scored.push({ id: c.id, score: both / (q.size + c.set.size - both) })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k).map(c => ({ id: c.id, name: EXIDX[c.id].n, score: round2(c.score) }))
}

/**
 * One name against the library: { status, score, exerciseId, exerciseName, candidates }.
 * `candidates` is up to three catalogue entries to offer when the user does not accept the
 * match, the match itself first. `customEx` is S.customEx, so a name the user already has as a
 * custom exercise keeps it.
 */
export function matchName(sourceText, { customEx = [] } = {}) {
  const name = String(sourceText || '').trim()
  if (!name) return { status: 'unmatched', score: 0, exerciseId: null, exerciseName: null, candidates: [] }
  const own = priorCustom(customEx, customId(name), name)
  if (own) return { status: 'exact', score: 1, exerciseId: own.id, exerciseName: own.n, candidates: [] }
  const near = closestExercises(name)
  const hit = canonicalExId(matchExercise(name))
  if (hit && EXIDX[hit]) {
    const score = round2(nameSimilarity(name, EXIDX[hit].n))
    const candidates = [{ id: hit, name: EXIDX[hit].n, score }, ...near.filter(c => c.id !== hit)].slice(0, 3)
    return { status: score >= MATCH_THRESHOLD ? 'exact' : 'fuzzy', score, exerciseId: hit, exerciseName: EXIDX[hit].n, candidates }
  }
  // Word overlap alone can pick the wrong variant ("bear plank" for "Plank"), so it never
  // counts as exact, however high it scores.
  if (near[0] && near[0].score >= FUZZY_FLOOR) return { status: 'fuzzy', score: near[0].score, exerciseId: near[0].id, exerciseName: near[0].name, candidates: near }
  return { status: 'unmatched', score: 0, exerciseId: null, exerciseName: null, candidates: near }
}

/** Every row from lib/anatoly-import.js with its match attached, order kept. */
export const matchRows = (rows, opts) => (rows || []).map(r => ({ ...r, ...matchName(r.sourceText, opts) }))

/** The custom exercise an unmatched name becomes: the CSV importer's shape and id scheme. */
export function customExerciseFor(sourceText) {
  const n = String(sourceText || '').trim().toLowerCase()
  return { id: customId(n), n, custom: true, eq: 'custom', tg: '', desc: '', bp: bpFromName(n) || 'upper legs' }
}

/**
 * After review: every row gets an exerciseId. A row the user rejected (`accepted === false`) or
 * that never matched gets a custom exercise under its own name; the same name twice gets one.
 * Returns { rows, customEx } where customEx holds only exercises that are new to `customEx`.
 */
export function resolveRows(rows, { customEx = [] } = {}) {
  const made = new Map()
  const out = (rows || []).map(r => {
    if (r.exerciseId && r.accepted !== false) return { ...r }
    const c = priorCustom(customEx, customId(r.sourceText), r.sourceText) || made.get(customId(r.sourceText)) || customExerciseFor(r.sourceText)
    if (!customEx.includes(c)) made.set(c.id, c)
    return { ...r, exerciseId: c.id, exerciseName: c.n, custom: true }
  })
  return { rows: out, customEx: [...made.values()] }
}
