// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// OG-022: the Home card and its Settings switch, with Health Connect faked.
const mocks = vi.hoisted(() => {
  const state = { S: null, sheets: [], android: true }
  state.snapshot = () => ({ S: state.S, update: mut => { const next = structuredClone(state.S); mut(next); state.S = next } })
  return state
})
vi.mock('../../store/useStore.js', () => {
  const useStore = sel => (sel ? sel(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('../../store/useUI.js', () => {
  const snap = () => ({ toast: vi.fn(), openSheet: r => { mocks.sheets.push(r); return {} } })
  const useUI = sel => (sel ? sel(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('../../lib/mobile.js', () => ({ MOBILE: true, isAndroid: async () => mocks.android }))
vi.mock('../../lib/health-read.js', async orig => ({
  ...(await orig()),
  healthReadStatus: vi.fn(), requestHealthRead: vi.fn(), readStats: vi.fn(), readWeights: vi.fn(),
}))

const hr = await import('../../lib/health-read.js')
const { default: HealthCards, HealthCardsRow } = await import('./HealthCards.jsx')

let host, root
const render = async el => { await act(async () => { root.render(el) }); await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
const button = label => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)
const ALL = { steps: true, calories: true, nutrition: true, sleep: true, restingHeartRate: true, heartRate: true, exercise: true }
const NONE = Object.fromEntries(Object.keys(ALL).map(k => [k, false]))
const STATS = { days: [
  { date: '2026-10-11', steps: 8654, kcalBurned: 3424, kcalEaten: null, proteinG: null, sleepScore: 78, sleepMins: 466 },
  { date: '2026-10-12', steps: 2155, kcalBurned: 2218, kcalEaten: null, proteinG: null, sleepScore: 64, sleepMins: 152 },
], vo2: { vo2Max: 44.1, method: 'cardio-based' } }

beforeEach(() => {
  mocks.S = { unit: 'kg' }; mocks.sheets = []; mocks.android = true
  hr.healthReadStatus.mockReset(); hr.requestHealthRead.mockReset(); hr.readStats.mockReset()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

describe('Home health card (OG-022)', () => {
  it('asks to connect when nothing is granted, and reads after the user allows it', async () => {
    hr.healthReadStatus.mockResolvedValueOnce({ status: 'available', granted: NONE }).mockResolvedValue({ status: 'available', granted: ALL })
    hr.readStats.mockResolvedValue(STATS)
    await render(<HealthCards />)
    expect(host.textContent).toContain('Nothing leaves this phone')
    await act(async () => { button('Connect').click() })
    await render(<HealthCards />)
    expect(hr.requestHealthRead).toHaveBeenCalled()
    expect(host.textContent).toContain('2,155')
  })

  it('shows sleep, steps, calories and asks for a birth year before VO2 max', async () => {
    hr.healthReadStatus.mockResolvedValue({ status: 'available', granted: ALL })
    hr.readStats.mockResolvedValue(STATS)
    await render(<HealthCards />)
    expect(hr.readStats).toHaveBeenCalledWith({ days: 7, age: null })
    const text = host.textContent
    expect(text).toContain('64')            // last night's score
    expect(text).toContain('2h 32m')        // and how long
    expect(text).toContain('7-day avg 78')
    expect(text).toContain('7-day avg 8,654')
    expect(text).toContain('2,218')
    expect(button('Add your birth year')).toBeTruthy()
    expect(text).not.toContain('44.1')

    await act(async () => { button('Add your birth year').click() })
    expect(mocks.sheets).toHaveLength(1)
  })

  it('shows VO2 max once the age is known, read with that age', async () => {
    mocks.S.birthYear = new Date().getFullYear() - 36
    hr.healthReadStatus.mockResolvedValue({ status: 'available', granted: ALL })
    hr.readStats.mockResolvedValue(STATS)
    await render(<HealthCards />)
    expect(hr.readStats).toHaveBeenCalledWith({ days: 7, age: 36 })
    expect(host.textContent).toContain('44.1')
    expect(host.textContent).toContain('From cardio heart rate')
  })

  it('is hidden by the Settings switch, on iOS, and without Health Connect', async () => {
    hr.healthReadStatus.mockResolvedValue({ status: 'available', granted: ALL })
    hr.readStats.mockResolvedValue(STATS)
    mocks.S.showHealthCards = false
    await render(<HealthCards />)
    expect(host.textContent).toBe('')
    mocks.S.showHealthCards = true; mocks.android = false
    await render(<HealthCards key="ios" />)
    expect(host.textContent).toBe('')
    mocks.android = true
    hr.healthReadStatus.mockResolvedValue({ status: 'unsupported', granted: NONE })
    await render(<HealthCards key="none" />)
    expect(host.textContent).toBe('')
  })

  it('the Settings switch turns the card off and on, as the body weight card\'s does', async () => {
    await render(<HealthCardsRow />)
    const sw = host.querySelector('input[type=checkbox], [role=switch]')
    expect(sw).toBeTruthy()
    await act(async () => { sw.click() })
    expect(mocks.S.showHealthCards).toBe(false)
  })
})

describe('body weight backfill (OG-024)', () => {
  it('offers to import weight when it is not granted', async () => {
    hr.healthReadStatus.mockResolvedValue({ status: 'available', granted: { ...ALL, weight: false } })
    hr.readStats.mockResolvedValue(STATS)
    await render(<HealthCards key="w1" />)
    expect(button('Import body weight')).toBeTruthy()
  })

  it('adds weigh-ins for dates the profile lacks and never replaces one already logged', async () => {
    const { backfillWeights } = await import('./HealthCards.jsx')
    const at = iso => Date.parse(iso + 'T07:00:00Z')
    mocks.S = { unit: 'kg', bodyweight: [{ d: '2026-10-10', w: 79, t: at('2026-10-10') }] }
    hr.readWeights.mockResolvedValue([
      { time: at('2026-10-09'), kg: 80.2, origin: 'com.fitbit.FitbitMobile' },
      { time: at('2026-10-10'), kg: 81.5, origin: 'com.fitbit.FitbitMobile' },   // already logged in openGym
      { time: at('2026-10-11'), kg: 80.8, origin: 'com.fitbit.FitbitMobile' },
    ])
    const added = await backfillWeights({ now: at('2026-10-12') })
    expect(added).toBe(2)
    expect(mocks.S.bodyweight.map(b => [b.d, b.w])).toEqual([['2026-10-09', 80.2], ['2026-10-10', 79], ['2026-10-11', 80.8]])
    const [start, end] = hr.readWeights.mock.calls[0]
    expect(end - start).toBeGreaterThan(9 * 365 * 86400000)
  })

  it('backfills on its own once weight is granted, and says how many came in', async () => {
    mocks.S = { unit: 'kg', bodyweight: [] }
    hr.healthReadStatus.mockResolvedValue({ status: 'available', granted: { ...ALL, weight: true } })
    hr.readStats.mockResolvedValue(STATS)
    hr.readWeights.mockResolvedValue([{ time: Date.parse('2026-10-01T07:00:00Z'), kg: 82, origin: 'com.fitbit.FitbitMobile' }])
    await render(<HealthCards key="w2" />)
    expect(mocks.S.bodyweight).toHaveLength(1)
    expect(button('Import body weight')).toBeFalsy()
  })
})
