import { describe, it, expect } from 'vitest'
import { exerciseConfig, buildRoutine, toProfileUnit } from './anatoly-routine.js'
import { NOTE_MAX } from './history.js'

const BENCH = '0025'          // barbell bench press
const PULLUP = '0652'         // pull-up (bodyweight)
const row = o => ({ sourceText: 'x', exerciseId: BENCH, sets: null, reps: null, repsMax: null, targetWeight: null, weightUnit: null, timeSeconds: null, notes: null, ...o })

describe('exerciseConfig', () => {
  it('carries sets, reps and weight straight across', () => {
    expect(exerciseConfig(row({ sets: 5, reps: 5, targetWeight: 70, weightUnit: 'kg' })))
      .toEqual({ cfg: { id: BENCH, sets: 5, reps: 5, weight: 70, mode: 'reps' }, missing: [] })
  })

  it('stores a rep range as top and bottom, the way upstream reads a range', () => {
    const { cfg } = exerciseConfig(row({ sets: 4, reps: 6, repsMax: 8, targetWeight: 100 }))
    expect(cfg).toMatchObject({ reps: 8, repsMin: 6 })
  })

  it('fills a missing number with upstream\'s default and says so in the note', () => {
    const { cfg, missing } = exerciseConfig(row({ reps: 10 }))
    expect(missing).toEqual(['sets'])
    expect(cfg.sets).toBe(3)
    expect(cfg.note).toBe('Not in the photo: sets')
  })

  it('keeps an unweighted row at zero load, which is not a missing number', () => {
    const { cfg, missing } = exerciseConfig(row({ exerciseId: PULLUP, sets: 3, reps: 8 }))
    expect(missing).toEqual([])
    expect(cfg).toMatchObject({ weight: 0, mode: 'reps', bodyweight: true })
  })

  it('makes a timed hold a time-mode exercise', () => {
    const { cfg } = exerciseConfig(row({ sets: 3, timeSeconds: 45 }))
    expect(cfg).toMatchObject({ mode: 'time', sec: 45, sets: 3, weight: 0 })
    expect(cfg.reps).toBeUndefined()
  })

  it('keeps "Time: Max" as a hold with a stated default, never a rep count', () => {
    const { cfg, missing } = exerciseConfig(row({ exerciseId: PULLUP, sets: 1, notes: 'Time: Max' }))
    expect(cfg.mode).toBe('time')
    expect(missing).toEqual(['time'])
    expect(cfg.note).toBe('Time: Max · Not in the photo: time')
  })

  it('converts the photo\'s unit to the profile\'s', () => {
    expect(exerciseConfig(row({ sets: 3, reps: 5, targetWeight: 225, weightUnit: 'lb' }), { unit: 'kg' }).cfg.weight).toBe(102)
    expect(exerciseConfig(row({ sets: 3, reps: 5, targetWeight: 100, weightUnit: 'kg' }), { unit: 'lb' }).cfg.weight).toBe(220)
    expect(exerciseConfig(row({ sets: 3, reps: 5, targetWeight: 100, weightUnit: null }), { unit: 'lb' }).cfg.weight).toBe(100)
  })

  it('caps the note at upstream\'s limit', () => {
    expect(exerciseConfig(row({ sets: 3, reps: 5, notes: 'x'.repeat(NOTE_MAX + 50) })).cfg.note).toHaveLength(NOTE_MAX)
  })
})

describe('toProfileUnit', () => {
  it('rounds kg to 0.5 and lb to 1, and passes null through', () => {
    expect(toProfileUnit(135, 'lb', 'kg')).toBe(61)
    expect(toProfileUnit(61.2, 'kg', 'lb')).toBe(135)
    expect(toProfileUnit(null, 'lb', 'kg')).toBe(null)
  })
})

describe('buildRoutine', () => {
  it('builds one routine in the reviewed order and skips a row with no exercise', () => {
    const r = buildRoutine([row({ sets: 5, reps: 5 }), row({ exerciseId: null }), row({ exerciseId: PULLUP, sets: 3, reps: 8 })], { name: ' Anatoly 14 Oct ', date: '2026-10-14' })
    expect(r).toMatchObject({ name: 'Anatoly 14 Oct', emoji: 'figureStrength', anatoly: { date: '2026-10-14' } })
    expect(r.ex.map(e => e.id)).toEqual([BENCH, PULLUP])
    expect(typeof r.id).toBe('string')
  })
})

import { saveImportedSession, staleImportedRoutines, tidyImportedRoutines } from './anatoly-routine.js'
import { deleteRoutine } from './routines.js'

describe('saving and tidying imported sessions (one per day, gone once the day has passed)', () => {
  const state = () => ({ routines: [{ id: 'mine', name: 'Push', ex: [] }], dayPlan: {}, week: { 1: ['mine'] }, customEx: [], active: null })
  const routine = (id, date) => ({ id, name: 'Anatoly', emoji: 'figureStrength', anatoly: { date }, ex: [] })

  it('adds the routine, pins it to the date, and merges only new custom exercises', () => {
    const s = state()
    s.customEx.push({ id: 'cx1', n: 'farmer carry' })
    saveImportedSession(s, routine('a1', null), { iso: '2026-10-14', customEx: [{ id: 'cx1', n: 'farmer carry' }, { id: 'cx2', n: 'sled push' }], deleteRoutine })
    expect(s.dayPlan['2026-10-14']).toBe('a1')
    expect(s.routines.find(r => r.id === 'a1').anatoly.date).toBe('2026-10-14')
    expect(s.customEx.map(c => c.id)).toEqual(['cx1', 'cx2'])
  })

  it('replaces an earlier import for the same date and leaves no pointer to it', () => {
    const s = state()
    saveImportedSession(s, routine('a1'), { iso: '2026-10-14', deleteRoutine })
    saveImportedSession(s, routine('a2'), { iso: '2026-10-14', deleteRoutine })
    expect(s.routines.map(r => r.id)).toEqual(['mine', 'a2'])
    expect(s.dayPlan).toEqual({ '2026-10-14': 'a2' })
  })

  it('keeps imports for other dates and never touches the user\'s own routines', () => {
    const s = state()
    saveImportedSession(s, routine('a1'), { iso: '2026-10-14', deleteRoutine })
    saveImportedSession(s, routine('a2'), { iso: '2026-10-15', deleteRoutine })
    expect(s.routines.map(r => r.id)).toEqual(['mine', 'a1', 'a2'])
    expect(s.week).toEqual({ 1: ['mine'] })
  })

  it('tidies only imported routines whose day is before today', () => {
    const s = state()
    saveImportedSession(s, routine('old'), { iso: '2026-10-11', deleteRoutine })
    saveImportedSession(s, routine('today'), { iso: '2026-10-12', deleteRoutine })
    saveImportedSession(s, routine('later'), { iso: '2026-10-13', deleteRoutine })
    expect(staleImportedRoutines(s, '2026-10-12')).toEqual(['old'])
    expect(tidyImportedRoutines(s, '2026-10-12', deleteRoutine)).toBe(1)
    expect(s.routines.map(r => r.id)).toEqual(['mine', 'today', 'later'])
    expect(s.dayPlan).toEqual({ '2026-10-12': 'today', '2026-10-13': 'later' })
  })

  it('a kept routine (OG-017) is never tidied or replaced, and stays pinned to its day', () => {
    const s = state()
    saveImportedSession(s, routine('kept'), { iso: '2026-10-11', deleteRoutine, keep: true })
    saveImportedSession(s, routine('oneoff'), { iso: '2026-10-11', deleteRoutine })
    expect(s.routines.map(r => r.id)).toEqual(['mine', 'kept', 'oneoff'])
    expect(s.routines.find(r => r.id === 'kept').anatoly).toEqual({ date: '2026-10-11', keep: true })
    expect(s.routines.find(r => r.id === 'oneoff').anatoly).toEqual({ date: '2026-10-11' })
    expect(staleImportedRoutines(s, '2026-10-12')).toEqual(['oneoff'])
    expect(tidyImportedRoutines(s, '2026-10-12', deleteRoutine)).toBe(1)
    expect(s.routines.map(r => r.id)).toEqual(['mine', 'kept'])
  })

  it('never removes a routine a running workout uses, past or replaced', () => {
    const s = state()
    saveImportedSession(s, routine('old'), { iso: '2026-10-11', deleteRoutine })
    s.active = { routineIds: ['old'] }
    expect(tidyImportedRoutines(s, '2026-10-12', deleteRoutine)).toBe(0)
    saveImportedSession(s, routine('again'), { iso: '2026-10-11', deleteRoutine })
    expect(s.routines.map(r => r.id)).toContain('old')
    s.active = { routineId: 'old' }
    expect(staleImportedRoutines(s, '2026-10-12')).toEqual(['again'])
  })
})

import { mainMuscleGroups } from './anatoly-routine.js'

describe('supersets from the photo (feedback after OG-013)', () => {
  const r = (id, g) => row({ exerciseId: id, sets: 3, reps: 10, supersetGroup: g })

  it('links adjacent rows of one group with a shared sg, and leaves the rest alone', () => {
    const { ex } = buildRoutine([r(BENCH, null), r(PULLUP, 'A'), r('0294', 'A'), r('0334', null)])
    expect(ex[0].sg).toBeUndefined()
    expect(ex[1].sg).toBeTruthy()
    expect(ex[2].sg).toBe(ex[1].sg)
    expect(ex[3].sg).toBeUndefined()
  })

  it('drops a group left with one member, as upstream does', () => {
    const { ex } = buildRoutine([r(BENCH, 'A'), r(PULLUP, null), r('0294', 'B'), r('0334', 'B')])
    expect(ex[0].sg).toBeUndefined()
    expect(ex[2].sg).toBe(ex[3].sg)
  })

  it('keeps two groups with the same label apart when they are not next to each other', () => {
    const { ex } = buildRoutine([r(BENCH, 'A'), r(PULLUP, 'A'), r('0294', null), r('0334', 'A'), r('0025', 'A')])
    expect(ex[0].sg).toBe(ex[1].sg)
    expect(ex[3].sg).toBe(ex[4].sg)
    expect(ex[3].sg).not.toBe(ex[0].sg)
  })

  it('a row dropped for having no exercise does not join the groups around it', () => {
    const { ex } = buildRoutine([r(BENCH, 'A'), row({ exerciseId: null, supersetGroup: 'A' }), r(PULLUP, 'A')])
    expect(ex).toHaveLength(2)
    expect(ex[0].sg).toBe(ex[1].sg)
  })
})

describe('mainMuscleGroups (session title)', () => {
  const bp = { c1: 'chest', c2: 'chest', a1: 'upper arms', a2: 'lower arms', s1: 'shoulders', l1: 'upper legs', l2: 'lower legs', w: 'waist' }
  const ex = (...pairs) => pairs.map(([id, sets]) => ({ id, sets }))
  const bpOf = id => bp[id]

  it('ranks by sets and keeps groups with at least half the busiest one\'s sets', () => {
    // chest 9, arms 6, shoulders 3: shoulders is under half of 9
    expect(mainMuscleGroups(ex(['c1', 5], ['c2', 4], ['a1', 3], ['a2', 3], ['s1', 3]), bpOf)).toEqual(['chest', 'arms'])
  })

  it('folds upper and lower body parts into one group and names at most three', () => {
    expect(mainMuscleGroups(ex(['l1', 4], ['l2', 4], ['w', 4], ['c1', 4], ['s1', 4]), bpOf)).toEqual(['legs', 'core', 'chest'])
  })

  it('counts an exercise with no sets as one, and ignores unknown body parts', () => {
    expect(mainMuscleGroups(ex(['c1', 0], ['zz', 9]), bpOf)).toEqual(['chest'])
    expect(mainMuscleGroups([], bpOf)).toEqual([])
  })
})
