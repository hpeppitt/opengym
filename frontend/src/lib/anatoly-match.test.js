import { describe, it, expect } from 'vitest'
import {
  matchName, matchRows, resolveRows, customExerciseFor, nameSimilarity, closestExercises,
  MATCH_THRESHOLD, FUZZY_FLOOR,
} from './anatoly-match.js'
import { importId } from './import-csv.js'
import { EXIDX } from './exercises.js'

// Expectations are read off the real catalogue (exercises-data.js), not a stub: the point of
// the matcher is how it behaves against the 5,600 names it will actually meet.

describe('nameSimilarity (fit-app utils/exerciseMatch.ts)', () => {
  it('scores fit-app\'s two reference cases the same way', () => {
    expect(nameSimilarity('standing low cable row', 'Seated Cable Row')).toBeCloseTo(0.4)
    expect(nameSimilarity('Romanian-Deadlift!', 'Romanian Deadlift')).toBe(1)
  })
  it('ignores word order and reads gym shorthand', () => {
    expect(nameSimilarity('row cable seated', 'Seated cable row')).toBe(1)
    expect(nameSimilarity('Incline DB press', 'incline dumbbell press')).toBe(1)
    expect(nameSimilarity('BB row', 'barbell row')).toBe(1)
  })
  it('handles empty names', () => {
    expect(nameSimilarity('', '')).toBe(1)
    expect(nameSimilarity('squat', '')).toBe(0)
  })
})

describe('matchName: the three states', () => {
  it('exact: a name the matcher resolves and that reads like the library name', () => {
    expect(matchName('Barbell bench press')).toMatchObject({ status: 'exact', score: 1, exerciseId: '0025' })
    expect(matchName('Seated cable row')).toMatchObject({ status: 'exact', exerciseId: '0861' })
    expect(matchName('Pull up')).toMatchObject({ status: 'exact', exerciseName: 'pull-up' })
  })

  it('fuzzy: a resolved match whose wording differs, so the user confirms it (fit-app FIT-120)', () => {
    // A curated alias that shares no word with the library name.
    const face = matchName('Face pull')
    expect(face).toMatchObject({ status: 'fuzzy', score: 0, exerciseId: '0203' })
    expect(face.candidates.map(c => c.name)).toContain('band face pull')
    expect(matchName('RDL')).toMatchObject({ status: 'fuzzy', exerciseId: '0085' })
  })

  it('fuzzy: a word-overlap candidate is never exact, however high it scores', () => {
    const m = matchName('Standing low cable row')
    expect(m.status).toBe('fuzzy')
    expect(m.score).toBeGreaterThanOrEqual(MATCH_THRESHOLD)
    expect(m.exerciseName).toBe('cable standing row')
  })

  it('unmatched: nothing close enough, with weaker candidates still offered', () => {
    const m = matchName('Farmer carry')
    expect(m).toMatchObject({ status: 'unmatched', score: 0, exerciseId: null, exerciseName: null })
    expect(m.candidates.length).toBeGreaterThan(0)
    expect(m.candidates.every(c => c.score < FUZZY_FLOOR)).toBe(true)
    expect(matchName('')).toMatchObject({ status: 'unmatched', candidates: [] })
  })

  it('a custom exercise the user already has wins, so a second import lands on the same history', () => {
    const own = { id: 'cx1', n: 'farmer carry', custom: true }
    expect(matchName('Farmer Carry', { customEx: [own] })).toMatchObject({ status: 'exact', score: 1, exerciseId: 'cx1' })
    // Matched by the id an earlier Anatoly import gave it, even after a rename.
    const renamed = { id: customExerciseFor('Sled push').id, n: 'prowler', custom: true }
    expect(matchName('Sled push', { customEx: [renamed] }).exerciseId).toBe(renamed.id)
  })
})

describe('the threshold', () => {
  it('is 0.65: exactly 0.6 asks, 0.67 passes', () => {
    expect(MATCH_THRESHOLD).toBe(0.65)
    // Upstream's matcher picks a camera-angle variant here; at 0.6 it must ask, not accept.
    const squat = matchName('Barbell back squat')
    expect(squat).toMatchObject({ status: 'fuzzy', score: 0.6, exerciseName: 'barbell full squat (back pov)' })
    expect(squat.candidates.map(c => c.name)).toContain('barbell squat')
    expect(matchName('Romanian deadlift')).toMatchObject({ status: 'exact', score: 0.67, exerciseId: '0085' })
  })

  it('offers no fuzzy candidate below the floor', () => {
    expect(FUZZY_FLOOR).toBeGreaterThan(0.25)
    expect(closestExercises('Farmer carry')[0].score).toBeLessThan(FUZZY_FLOOR)
  })
})

describe('closestExercises', () => {
  it('returns up to three real entries, best first, stable on ties', () => {
    const near = closestExercises('Plank')
    expect(near).toHaveLength(3)
    expect(near.every(c => EXIDX[c.id] && c.name === EXIDX[c.id].n)).toBe(true)
    expect(near.map(c => c.score)).toEqual([...near.map(c => c.score)].sort((a, b) => b - a))
    expect(closestExercises('Plank')).toEqual(near)
    expect(closestExercises('')).toEqual([])
  })
})

describe('matchRows', () => {
  it('attaches a match to every row and keeps the row\'s own fields and order', () => {
    const rows = matchRows([
      { sourceText: 'Barbell bench press', sets: 5, reps: 5, targetWeight: 70 },
      { sourceText: 'Farmer carry', sets: 2, reps: null, timeSeconds: 40 },
    ])
    expect(rows.map(r => [r.sourceText, r.status])).toEqual([['Barbell bench press', 'exact'], ['Farmer carry', 'unmatched']])
    expect(rows[0]).toMatchObject({ sets: 5, reps: 5, targetWeight: 70 })
    expect(rows[1]).toMatchObject({ timeSeconds: 40 })
  })
})

describe('resolveRows: unmatched becomes a custom exercise, as the CSV importer does', () => {
  it('gives an unmatched row a custom exercise in the CSV importer\'s shape and id scheme', () => {
    const { rows, customEx } = resolveRows(matchRows([{ sourceText: 'Farmer carry', sets: 2 }]))
    const c = customEx[0]
    expect(c).toEqual({ id: importId('an', 'Anatoly|farmer carry'), n: 'farmer carry', custom: true, eq: 'custom', tg: '', desc: '', bp: expect.any(String) })
    expect(rows[0]).toMatchObject({ exerciseId: c.id, exerciseName: 'farmer carry', custom: true, sets: 2 })
  })

  it('reads the body part off the name, with the CSV importer\'s default', () => {
    expect(customExerciseFor('Cossack squat').bp).toBe('upper legs')
    expect(customExerciseFor('Pallof hold core').bp).toBe('waist')
  })

  it('keeps accepted matches, and turns a rejected one into a custom exercise', () => {
    const matched = matchRows([{ sourceText: 'Barbell bench press' }, { sourceText: 'Face pull' }])
    matched[1].accepted = false
    const { rows, customEx } = resolveRows(matched)
    expect(rows[0]).toMatchObject({ exerciseId: '0025' })
    expect(rows[0].custom).toBeUndefined()
    expect(rows[1]).toMatchObject({ exerciseName: 'face pull', custom: true })
    expect(customEx.map(c => c.n)).toEqual(['face pull'])
  })

  it('makes one custom exercise for a name that appears twice', () => {
    const { rows, customEx } = resolveRows(matchRows([{ sourceText: 'Farmer carry' }, { sourceText: 'farmer carry ' }]))
    expect(customEx).toHaveLength(1)
    expect(rows[0].exerciseId).toBe(rows[1].exerciseId)
  })

  it('reuses a custom exercise the user already has and does not return it as new', () => {
    const own = customExerciseFor('Farmer carry')
    const rows = [{ sourceText: 'Farmer carry', status: 'unmatched', exerciseId: null }]
    const out = resolveRows(rows, { customEx: [own] })
    expect(out.rows[0].exerciseId).toBe(own.id)
    expect(out.customEx).toEqual([])
  })
})
