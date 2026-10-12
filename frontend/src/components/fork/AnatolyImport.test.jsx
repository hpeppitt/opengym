// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// OG-013's sheet end to end, with the network and image decoding swapped out: photos in, a
// review where every fuzzy row must be confirmed, and a routine pinned to its day on Save.
const mocks = vi.hoisted(() => {
  const state = { S: null, sheets: [], toasts: [] }
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
vi.mock('../../lib/mobile.js', () => ({ MOBILE: true }))
vi.mock('../../lib/gemini-key.js', () => ({ getGeminiKey: vi.fn(async () => 'AIzaTest') }))
vi.mock('./anatoly-images.js', () => ({ toImage: vi.fn(async () => ({ mimeType: 'image/jpeg', base64: 'AAAA' })) }))
vi.mock('../../lib/anatoly-import.js', async orig => ({ ...(await orig()), importFromImages: vi.fn() }))

const { importFromImages, AnatolyImportError } = await import('../../lib/anatoly-import.js')
const { default: AnatolyImportButton } = await import('./AnatolyImport.jsx')
const { todayISO } = await import('../../lib/format.js')

const ROWS = [
  { sourceText: 'Barbell bench press', sets: 5, reps: 5, repsMax: null, targetWeight: 70, weightUnit: 'kg', timeSeconds: null, notes: null },
  { sourceText: 'Face pull', sets: 3, reps: 15, repsMax: null, targetWeight: null, weightUnit: null, timeSeconds: null, notes: null },
  { sourceText: 'Farmer carry', sets: 2, reps: null, repsMax: null, targetWeight: 32, weightUnit: 'kg', timeSeconds: 40, notes: null },
]

let host, root
const render = async el => { await act(async () => { root.render(el) }) }
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const button = label => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label || b.getAttribute('aria-label') === label)
const click = async el => { await act(async () => { el.click() }) }

async function openSheet() {
  await render(<AnatolyImportButton />)
  await click(button('Import a session from photos'))
  const sheet = mocks.sheets.pop()
  await render(sheet(() => { mocks.closed = true }))
}
async function pickPhotos() {
  const input = host.querySelector('input[type=file]')
  Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.png', { type: 'image/png' })], configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
}

beforeEach(() => {
  mocks.S = { unit: 'kg', routines: [{ id: 'mine', name: 'Push', ex: [] }], week: {}, dayPlan: {}, customEx: [], active: null }
  mocks.sheets = []; mocks.toasts = []; mocks.closed = false
  importFromImages.mockReset()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

describe('Anatoly import sheet (OG-013)', () => {
  it('reads photos, holds Save until the fuzzy row is confirmed, then pins a routine to the day', async () => {
    importFromImages.mockResolvedValue(ROWS)
    await openSheet()
    expect(button('Read photos').disabled).toBe(true)
    await pickPhotos()
    await click(button('Read photos'))
    await flush()
    expect(importFromImages).toHaveBeenCalledWith('AIzaTest', [{ mimeType: 'image/jpeg', base64: 'AAAA' }])
    expect(host.textContent).toContain('Check the session')
    expect(host.textContent).toContain('Rows to check: 1')
    expect(button('Save session').disabled).toBe(true)

    await click(button('Looks right'))
    expect(button('Save session').disabled).toBe(false)
    await click(button('Save session'))

    const iso = todayISO()
    const saved = mocks.S.routines.find(r => r.anatoly)
    expect(mocks.S.dayPlan[iso]).toBe(saved.id)
    expect(saved.anatoly.date).toBe(iso)
    expect(saved.ex.map(e => e.id).slice(0, 2)).toEqual(['0025', '0203'])
    expect(saved.ex[0]).toMatchObject({ sets: 5, reps: 5, weight: 70, mode: 'reps' })
    expect(saved.ex[2]).toMatchObject({ mode: 'time', sec: 40, weight: 32 })
    expect(mocks.S.customEx.map(c => c.n)).toEqual(['farmer carry'])
    expect(saved.ex[2].id).toBe(mocks.S.customEx[0].id)
    expect(mocks.S.routines[0].id).toBe('mine')
    expect(mocks.closed).toBe(true)
  })

  it('says what went wrong in words, by error code', async () => {
    importFromImages.mockRejectedValue(new AnatolyImportError('truncated'))
    await openSheet()
    await pickPhotos()
    await click(button('Read photos'))
    await flush()
    expect(mocks.toasts).toEqual(['Gemini’s answer was cut off. Try fewer photos at once.'])
    expect(button('Read photos')).toBeTruthy()
  })

  it('tidies past days\' imported routines when Plan opens, and leaves today\'s and the user\'s own', async () => {
    const today = todayISO()
    mocks.S.routines.push({ id: 'old', name: 'Anatoly', anatoly: { date: '2000-01-01' }, ex: [] }, { id: 'now', name: 'Anatoly', anatoly: { date: today }, ex: [] })
    mocks.S.dayPlan = { '2000-01-01': 'old', [today]: 'now' }
    await render(<AnatolyImportButton />)
    expect(mocks.S.routines.map(r => r.id)).toEqual(['mine', 'now'])
    expect(mocks.S.dayPlan).toEqual({ [today]: 'now' })
  })
})
