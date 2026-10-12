// Anatoly program import, step 1: photos of a prescribed session in, rows out (fork OG-011).
//
// Ported from fit-app's services/workoutImageImport.ts (FIT-095, FIT-116, FIT-125, FIT-091),
// with one deliberate departure (docs/fork/ARCHITECTURE.md): fit-app put its 80-exercise
// library in the prompt and had Gemini pick ids. openGym's library is ~5,600 entries, far too
// many for a prompt, so Gemini only reads names here and lib/anatoly-match.js (OG-012) matches
// them on the phone.
//
// The rules fit-app learned the hard way are kept: never invent sets, reps or weight (an absent
// number is null, never a default); a timed hold has reps null and a duration instead; a hold
// written "Max" keeps its wording in notes; the exercise name is kept exactly as written so a
// substitution can be reviewed, not hidden; a truncated answer is reported as truncation, not
// as a parser bug.
//
// Pure except importFromImages(), which takes its fetch as a parameter so tests can drive it.
// Errors are AnatolyImportError with a stable `code`; the import sheet (OG-013) turns codes into
// translated messages. The key travels as a header, never in the URL (as upstream's Coach does).

export const ANATOLY_MODEL = 'gemini-3.5-flash'
// gemini-3.5-flash thinks, and thinking tokens count against this budget (fit-app FIT-091).
export const MAX_OUTPUT_TOKENS = 8192
const API = 'https://generativelanguage.googleapis.com/v1beta/models/'

export class AnatolyImportError extends Error {
  constructor(code, message, extra = {}) {
    super(message || code)
    this.name = 'AnatolyImportError'
    this.code = code
    Object.assign(this, extra)
  }
}

export function buildImportPrompt() {
  return `You are reading one or more screenshots or photos of a single prescribed strength
workout: sets, reps and target weight for a session someone is about to perform, not a record
of completed work. Extract it as a JSON object. The images may be several screens of the same
session (for example a scrolled program view); treat them as one workout.

## REQUIREMENTS
- Report exercises in the order they appear in the images.
- If the images are too blurry, dark, cropped or otherwise unreadable to find any workout text,
  set "imageReadable" to false and return an empty "exercises" array.
- If the images are readable but do not show a workout plan, set "imageReadable" to true and
  return an empty "exercises" array.
- Never invent sets, reps or weight that are not shown. Anything not shown is null.
- "sourceText" is the exercise name exactly as written in the image. Do not translate,
  correct or rename it.
- If reps are a range such as "8-10", put the low end in "reps" and the high end in "repsMax".
  Otherwise "repsMax" is null.
- "weight" is the target weight as a number. "weightUnit" is "kg" or "lb" when the image shows
  the unit, otherwise null.
- Some exercises are prescribed by duration instead of reps (a plank, a dead hang). For those,
  "reps" is null and "timeSeconds" is the duration in seconds. If the duration is unbounded or
  written as "Max", "timeSeconds" is null too, and the original wording (for example
  "Time: Max") goes in "notes".
- "notes" holds any other instruction shown for the exercise (tempo, rest, RPE), or null.
- Exercises done back to back as a superset, circuit or giant set share a "supersetGroup": the
  same short label for every exercise in the group (for example "A"), in the order shown. Look
  for any visible link: a bracket or line joining them, a shared label such as A1/A2, or the
  word "superset" or "circuit". An exercise on its own has "supersetGroup": null.

## JSON STRUCTURE (output only valid JSON, no markdown)
{
  "imageReadable": boolean,
  "exercises": [
    { "sourceText": string, "sets": number|null, "reps": number|null, "repsMax": number|null, "weight": number|null, "weightUnit": "kg"|"lb"|null, "timeSeconds": number|null, "notes": string|null, "supersetGroup": string|null }
  ]
}`
}

/**
 * The JSON object in a model answer, fences stripped. Throws `truncated` when the answer opens an
 * object it never closes, and `no-json` when there is no object at all.
 *
 * fit-app only called it truncation when no closing brace appeared anywhere, which misses the
 * usual case: the budget runs out after a few complete exercises, so inner objects have closed
 * and the answer was misreported as malformed. Depth is counted outside strings instead.
 */
export function extractJsonBlock(text) {
  const s = String(text ?? '').replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '')
  const start = s.indexOf('{')
  if (start === -1) throw new AnatolyImportError('no-json', 'The answer held no JSON.')
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
    } else if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return s.slice(start, i + 1)
  }
  throw new AnatolyImportError('truncated', 'The answer was cut off before the JSON closed.')
}

// A number the model reported, or null. Never a default: fit-app stored a fabricated 3 sets and
// 8 reps for a dead hang before FIT-116 and FIT-125 made absent mean null.
const num = (v, { min = 0, exclusive = false } = {}) => {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null
  const n = Number(typeof v === 'string' ? v.trim().replace(',', '.') : v)
  if (!Number.isFinite(n)) return null
  if (exclusive ? n <= min : n < min) return null
  return n
}
const count = v => { const n = num(v, { exclusive: true }); return n === null ? null : Math.round(n) }
const text = v => (typeof v === 'string' && v.trim() ? v.trim() : null)
// A superset label as the model wrote it ("A", "a", 1), normalised; anything empty is no group.
const group = v => (typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : null)
const unit = v => { const u = typeof v === 'string' ? v.trim().toLowerCase() : ''; return u === 'kg' ? 'kg' : (u === 'lb' || u === 'lbs') ? 'lb' : null }

/**
 * A model answer as rows: { sourceText, sets, reps, repsMax, targetWeight, weightUnit,
 * timeSeconds, notes, supersetGroup }[]. Whole-answer failures throw with their own code: `truncated`,
 * `no-json`, `unparseable`, `unreadable` (could not read the images), `structure`, and `empty`
 * (read the images, found no exercise).
 */
export function parseImportResponse(answer) {
  const json = extractJsonBlock(answer)
  let parsed
  try { parsed = JSON.parse(json) } catch {
    throw new AnatolyImportError('unparseable', 'The JSON in the answer did not parse; it may have been cut off.')
  }
  if (parsed?.imageReadable === false) throw new AnatolyImportError('unreadable', 'The images could not be read.')
  if (!parsed || !Array.isArray(parsed.exercises)) throw new AnatolyImportError('structure', 'The answer had no exercises array.')

  const rows = []
  for (const ex of parsed.exercises) {
    const sourceText = text(ex?.sourceText) || text(ex?.exerciseName) || text(ex?.name)
    if (!sourceText) continue // nothing to match or show: a row without a name is not a row
    const reps = count(ex?.reps)
    let repsMax = count(ex?.repsMax)
    if (repsMax !== null && (reps === null || repsMax <= reps)) repsMax = null
    rows.push({
      sourceText,
      sets: count(ex?.sets),
      reps,
      repsMax,
      targetWeight: num(ex?.weight ?? ex?.targetWeight),
      weightUnit: unit(ex?.weightUnit),
      timeSeconds: reps === null ? count(ex?.timeSeconds) : null,
      notes: text(ex?.notes),
      supersetGroup: group(ex?.supersetGroup),
    })
  }
  if (!rows.length) throw new AnatolyImportError('empty', 'The images were read but showed no exercises.')
  return rows
}

/** The text of a generateContent answer. Throws `max-tokens`, `blocked`, `stopped` or `no-text`. */
export function readCandidate(data) {
  const cand = data?.candidates?.[0]
  if (!cand) {
    const block = data?.promptFeedback?.blockReason
    throw new AnatolyImportError(block ? 'blocked' : 'no-text', block ? `The request was blocked: ${block}` : 'The answer had no candidates.')
  }
  // A thinking model can spend the whole budget before writing anything (fit-app FIT-091).
  if (cand.finishReason === 'MAX_TOKENS') throw new AnatolyImportError('max-tokens', 'The answer hit the output token budget.')
  if (cand.finishReason && cand.finishReason !== 'STOP') throw new AnatolyImportError('stopped', `The model stopped early: ${cand.finishReason}`, { finishReason: cand.finishReason })
  const out = (cand.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('')
  if (!out.trim()) throw new AnatolyImportError('no-text', 'The answer was empty.')
  return out
}

/** The request body for a set of images: [{ base64, mimeType }], base64 without a data: prefix. */
export function buildRequest(images) {
  return {
    contents: [{ role: 'user', parts: [{ text: buildImportPrompt() }, ...images.map(i => ({ inlineData: { mimeType: i.mimeType, data: i.base64 } }))] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: MAX_OUTPUT_TOKENS, responseMimeType: 'application/json' },
  }
}

/**
 * Photos to rows, over the network. Throws AnatolyImportError: `no-key`, `no-images`, `network`,
 * `auth` (key refused), `http` (with `status`), then anything readCandidate or
 * parseImportResponse throws.
 */
export async function importFromImages(apiKey, images, { fetch: doFetch = globalThis.fetch, signal } = {}) {
  const key = String(apiKey ?? '').trim()
  if (!key) throw new AnatolyImportError('no-key', 'No Gemini API key is saved.')
  if (!Array.isArray(images) || !images.length) throw new AnatolyImportError('no-images', 'No images were chosen.')
  let res
  try {
    res = await doFetch(API + encodeURIComponent(ANATOLY_MODEL) + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(buildRequest(images)),
      signal,
    })
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    throw new AnatolyImportError('network', 'Could not reach Gemini.', { cause: e })
  }
  let data = null
  try { data = await res.json() } catch { /* an error page, or nothing */ }
  if (!res.ok) {
    const msg = data?.error?.message || ''
    const refused = res.status === 401 || res.status === 403 || /api key/i.test(msg)
    throw new AnatolyImportError(refused ? 'auth' : 'http', msg || `Gemini answered ${res.status}`, { status: res.status })
  }
  return parseImportResponse(readCandidate(data))
}
