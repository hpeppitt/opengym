// Gemini answers for anatoly-import.test.js (OG-011). Shaped like real generateContent output
// for a prescribed Anatoly session; the edge cases are the ones fit-app hit in use.

export const CLEAN = JSON.stringify({
  imageReadable: true,
  exercises: [
    { sourceText: 'Barbell back squat', sets: 4, reps: 6, repsMax: 8, weight: 100, weightUnit: 'kg', timeSeconds: null, notes: 'Rest 3 min' },
    { sourceText: 'Romanian deadlift', sets: 3, reps: 10, repsMax: null, weight: 80, weightUnit: 'kg', timeSeconds: null, notes: null },
    { sourceText: 'Standing low cable row', sets: 3, reps: 12, repsMax: null, weight: null, weightUnit: null, timeSeconds: null, notes: null },
    { sourceText: 'Plank', sets: 3, reps: null, repsMax: null, weight: null, weightUnit: null, timeSeconds: 45, notes: null },
    { sourceText: 'Dead hang', sets: 1, reps: null, repsMax: null, weight: null, weightUnit: null, timeSeconds: null, notes: 'Time: Max' },
  ],
})

export const FENCED = '```json\n' + JSON.stringify({ imageReadable: true, exercises: [{ sourceText: 'Bench press', sets: 5, reps: 5, weight: 70, weightUnit: 'kg' }] }) + '\n```'

// The token budget ran out mid-answer: an opening brace, never a closing one.
export const TRUNCATED = '{"imageReadable": true, "exercises": [{"sourceText": "Barbell back squat", "sets": 4, "reps": 6, "weight": 100}, {"sourceText": "Romanian dead'

// Cut off after a nested object closed: the outer braces are unbalanced but a `{...}` slice exists.
export const TRUNCATED_INNER = '{"imageReadable": true, "exercises": [{"sourceText": "Bench press", "sets": 5, "reps": 5}, {"sourceText": "Row"'

export const UNREADABLE = JSON.stringify({ imageReadable: false, exercises: [] })
export const NO_EXERCISES = JSON.stringify({ imageReadable: true, exercises: [] })

// What a model does when it drifts from the schema: strings for numbers, a decimal comma,
// "lbs", missing fields, a key renamed, a bogus range, an unnamed row.
export const MESSY = JSON.stringify({
  imageReadable: true,
  exercises: [
    { sourceText: '  Incline DB press ', sets: '3', reps: '10', weight: '22,5', weightUnit: 'LBS' },
    { exerciseName: 'Lat pulldown', reps: 12 },
    { sourceText: 'Lunges', sets: 3, reps: 10, repsMax: 8, weight: 'bodyweight' },
    { sourceText: 'Face pull', sets: 0, reps: -5, weight: -10, weightUnit: 'stone' },
    { sets: 3, reps: 10 },
    { sourceText: 'Farmer carry', sets: 2, reps: 20, timeSeconds: 30, weight: 32 },
  ],
})

/** A generateContent HTTP body around an answer, with a thinking part first. */
export const envelope = (text, finishReason = 'STOP') => ({
  candidates: [{ finishReason, content: { role: 'model', parts: [{ text: 'Reading the rows…', thought: true }, { text }] } }],
  usageMetadata: { promptTokenCount: 1800, candidatesTokenCount: 420, thoughtsTokenCount: 900 },
})
