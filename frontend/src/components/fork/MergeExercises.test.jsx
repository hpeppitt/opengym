// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// OG-025 end to end: Settings row, the list, a suggested match or a library search, the confirm
// step, and the merged state.
const mocks = vi.hoisted(() => {
  const state = { S: null, sheets: [], toasts: [], confirms: [] }
  state.snapshot = () => ({ S: state.S, update: mut => { const next = structuredClone(state.S); mut(next); state.S = next } })
  return state
})
vi.mock('../../store/useStore.js', () => {
  const useStore = sel => (sel ? sel(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('../../store/useUI.js', () => {
  const snap = () => ({ toast: m => mocks.toasts.push(m), openSheet: render => { mocks.sheets.push(render); return {} } })
  const useUI = sel => (sel ? sel(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('../../sheets.jsx', () => ({
  exercisePicker: vi.fn((onPick, opts) => { mocks.pick = { onPick, opts, close: vi.fn() }; return mocks.pick }),
  confirmSheet: vi.fn(opts => mocks.confirms.push(opts)),
}))

const { MergeExercisesRow, MergeExerciseButton } = await import('./MergeExercises.jsx')
const { EXIDX, registerCustom } = await import('../../lib/exercises.js')
const { mergeSuggestions } = await import('../../lib/merge-exercise.js')

const CX = { id: 'imbench', n: 'bench press', bp: 'chest', eq: 'custom', custom: true }
const CARDIO = '4918'

let host, root
const render = async el => { await act(async () => { root.render(el) }) }
const buttons = () => [...host.querySelectorAll('button')]
const byText = text => buttons().find(b => b.textContent.toLowerCase().includes(text.toLowerCase()))
const click = async el => { await act(async () => { el.click() }) }
const openTop = async () => { const sheet = mocks.sheets.pop(); await render(sheet(() => { mocks.closed = true })) }

beforeEach(() => {
  registerCustom([CX])
  mocks.S = {
    customEx: [CX], active: null, favEx: [], exWeights: { imbench: 80 },
    workouts: [{ id: 'w1', d: '2026-07-08', entries: [{ id: 'imbench', n: 'bench press', sets: [{ w: 80, r: 5, done: true }] }], prs: [] }],
    routines: [{ id: 'r1', name: 'Push', ex: [{ id: 'imbench', sets: 3, reps: 5 }] }],
  }
  mocks.sheets = []; mocks.toasts = []; mocks.confirms = []; mocks.closed = false
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); registerCustom([]) })

describe('Merge custom exercises', () => {
  it('Settings row hides when there is nothing to merge', async () => {
    mocks.S.customEx = []
    await render(<MergeExercisesRow />)
    expect(host.textContent).toBe('')
  })

  it('list, suggestion, confirm: the history moves to the library exercise', async () => {
    await render(<MergeExercisesRow />)
    expect(host.textContent).toContain('1 custom exercises')
    await click(byText('Merge custom exercises'))
    await openTop()
    expect(host.textContent).toContain('1 workout ·')
    expect(host.textContent).toMatch(/Closest: .*bench press/i)
    await click(byText('bench press'))
    await openTop()
    const expected = mergeSuggestions('bench press')[0]
    await click(buttons().find(b => b.querySelector('.lrow-t')))
    expect(mocks.confirms).toHaveLength(1)
    expect(mocks.confirms[0].message).toContain('1 workout and 1 routine slot move')
    mocks.confirms[0].onConfirm()
    const id = mocks.S.workouts[0].entries[0].id
    expect(id).toBe(expected)
    expect(EXIDX[id].custom).not.toBe(true)
    expect(mocks.S.routines[0].ex[0].id).toBe(id)
    expect(mocks.S.exWeights).toEqual({ [id]: 80 })
    expect(mocks.S.customEx).toEqual([])
    expect(mocks.toasts.at(-1)).toMatch(/^Merged into/)
  })

  it('detail button: search the library, refuse a different kind of exercise, then merge and close', async () => {
    await render(<MergeExerciseButton ex={CX} close={() => { mocks.closedDetail = true }} />)
    await click(byText('Merge into another exercise'))
    await openTop()
    await click(byText('Search the library'))
    expect(mocks.pick.opts.like).toBe('imbench')
    mocks.pick.onPick(EXIDX[CARDIO])
    expect(mocks.confirms).toHaveLength(0)
    expect(mocks.toasts.at(-1)).toMatch(/logged the same way/)
    await click(byText('Search the library'))
    mocks.pick.onPick(EXIDX['0025'])
    expect(mocks.pick.close).toHaveBeenCalled()
    mocks.confirms[0].onConfirm()
    expect(mocks.S.workouts[0].entries[0].id).toBe('0025')
    expect(mocks.closedDetail).toBe(true)
  })

  it('refuses while the running workout uses it', async () => {
    mocks.S.active = { entries: [{ id: 'imbench' }] }
    await render(<MergeExerciseButton ex={CX} close={() => {}} />)
    await click(byText('Merge into another exercise'))
    await openTop()
    await click(byText('Search the library'))
    mocks.pick.onPick(EXIDX['0025'])
    expect(mocks.confirms).toHaveLength(0)
    expect(mocks.toasts.at(-1)).toBe('Finish your current workout first')
  })
})
