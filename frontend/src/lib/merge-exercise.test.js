import { afterEach, describe, expect, it } from 'vitest'
import { registerCustom } from './exercises.js'
import { EXIDX } from './exercises.js'
import { exerciseUsage, mergeBlocker, mergeExercise, mergeSuggestions } from './merge-exercise.js'

const BENCH = '0025'          // barbell bench press
const HOP = '4918'            // a cardio exercise
const CX = { id: 'imx1', n: 'bench press', bp: 'chest', eq: 'custom', custom: true }

afterEach(() => registerCustom([]))

const state = () => ({
  customEx: [CX, { id: 'imx2', n: 'other', bp: 'back', custom: true }],
  workouts: [
    { id: 'w1', d: '2026-07-01', entries: [{ id: BENCH, sets: [{ w: 60, r: 5, done: true }] }], prs: [BENCH] },
    { id: 'w2', d: '2026-07-08', entries: [{ id: 'imx1', n: 'bench press', muscleSnapshot: { n: 'bench press' }, sets: [{ w: 80, r: 5, done: true }] }], prs: [] },
    { id: 'w3', d: '2026-07-15', entries: [{ id: BENCH, sets: [{ w: 70, r: 5, done: true }] }], prs: [BENCH] },
    { id: 'w4', d: '2026-07-20', entries: [{ id: '0001', sets: [{ w: 20, r: 10, done: true }] }], prs: ['0001'] },
  ],
  routines: [{ id: 'r1', name: 'Push', ex: [{ id: 'imx1', sets: 3, reps: 5, sg: 1 }, { id: '0001', sets: 3, sg: 1 }] }],
  exWeights: { imx1: 80, [BENCH]: 70 },
  exNotes: { imx1: 'seat 4' },
  barWeights: { imx1: 15 },
  favEx: ['imx1', BENCH],
  active: null,
})

describe('mergeExercise', () => {
  it('moves every logged set and routine slot to the target and removes the custom exercise', () => {
    const s = mergeExercise(state(), 'imx1', BENCH, 1000)
    expect(s.workouts[1].entries[0]).toEqual({ id: BENCH, sets: [{ w: 80, r: 5, done: true }] })
    expect(s.workouts[1]._ts).toBe(1000)
    expect(s.workouts[0]._ts).toBeUndefined()
    expect(s.routines[0].ex.map(e => e.id)).toEqual([BENCH, '0001'])
    expect(s.routines[0].ex[0]).toMatchObject({ sets: 3, reps: 5, sg: 1 })
    expect(s.customEx.map(c => c.id)).toEqual(['imx2'])
    expect(exerciseUsage(s, 'imx1')).toEqual({ workouts: 0, routines: 0 })
    expect(exerciseUsage(s, BENCH)).toEqual({ workouts: 3, routines: 1 })
  })

  it('keeps the target own settings and adopts the custom one only where the target has none', () => {
    const s = mergeExercise(state(), 'imx1', BENCH)
    expect(s.exWeights).toEqual({ [BENCH]: 70 })
    expect(s.exNotes).toEqual({ [BENCH]: 'seat 4' })
    expect(s.barWeights).toEqual({ [BENCH]: 15 })
    expect(s.favEx).toEqual([BENCH])
  })

  it('takes away a record the merged sets now beat, and invents none', () => {
    const s = mergeExercise(state(), 'imx1', BENCH)
    // 80 kg on 8 Jul (no badge: imported) now leads 70 kg on 15 Jul, whose badge goes.
    expect(s.workouts[0].prs).toEqual([BENCH])
    expect(s.workouts[1].prs).toEqual([])
    expect(s.workouts[2].prs).toEqual([])
    expect(s.workouts[3].prs).toEqual(['0001'])
  })

  it('is a no-op for the same id or a missing one', () => {
    const a = state()
    expect(mergeExercise(a, 'imx1', 'imx1')).toEqual(state())
    expect(mergeExercise(a, 'imx1', null)).toEqual(state())
  })

  it('can merge one custom exercise into another', () => {
    const s = mergeExercise(state(), 'imx1', 'imx2')
    expect(s.workouts[1].entries[0].id).toBe('imx2')
    expect(s.customEx.map(c => c.id)).toEqual(['imx2'])
  })
})

describe('mergeBlocker', () => {
  const bench = { id: BENCH, n: 'barbell bench press', bp: 'chest' }
  it('allows a custom exercise into one logged the same way', () => {
    expect(mergeBlocker(state(), CX, bench)).toBe(null)
  })
  it('refuses a built-in, itself, a different way of logging, or one in the running workout', () => {
    expect(mergeBlocker(state(), bench, CX)).toBe('not-custom')
    expect(mergeBlocker(state(), CX, CX)).toBe('same')
    expect(mergeBlocker(state(), CX, { id: HOP, n: 'hop', bp: 'cardio' })).toBe('mode')
    expect(mergeBlocker({ ...state(), active: { entries: [{ id: 'imx1' }] } }, CX, bench)).toBe('active')
  })
})

describe('mergeSuggestions', () => {
  const names = n => mergeSuggestions(n).map(id => EXIDX[id].n)
  it('reads a plural import name as the singular library one', () => {
    expect(names('Lat Pulldowns')[0]).toMatch(/lat pulldown/)
    expect(names('Rack pulls deadlift (5–7 cm elevation)')[0]).toMatch(/rack pull/)
  })
  it('leaves a word ending in ss alone and offers at most four, no repeats', () => {
    expect(names('Bench press')[0]).toBe('barbell bench press')
    const ids = mergeSuggestions('Bench press')
    expect(ids.length).toBeLessThanOrEqual(4)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
