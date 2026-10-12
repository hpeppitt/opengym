// Home → Health stats (fork OG-022): last night's sleep score, today's steps and calories, and a
// 30-day VO2 max, read from Health Connect (lib/health-read.js). Phone builds on Android only,
// hidden by the switch in Settings → Look & Home → On Home, as the body weight card is. Both are
// hooked into upstream files by one line each.
import { useEffect, useState } from 'react'
import { t } from '../../lib/i18n.js'
import { MOBILE, isAndroid } from '../../lib/mobile.js'
import { fmtNum, fmtDur } from '../../lib/format.js'
import { healthReadStatus, requestHealthRead, readStats, summarizeStats, ageFrom } from '../../lib/health-read.js'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { Button, Row, Switch, TextField } from '../ui.jsx'
import Icon from '../Icon.jsx'

const shown = S => S.showHealthCards !== false
const n = v => (v == null ? '–' : fmtNum(Math.round(v)))

// The last good read, kept across visits to Home so the card does not flash empty each time.
let last = null

export default function HealthCards() {
  const S = useStore(s => s.S)
  const [android, setAndroid] = useState(false)
  const [state, setState] = useState(last ? { kind: 'data', stats: last } : { kind: 'loading' })
  const on = MOBILE && android && shown(S)
  const age = ageFrom(S.birthYear)

  const load = async () => {
    try {
      const st = await healthReadStatus()
      if (st.status !== 'available') return setState({ kind: 'none' })
      if (!Object.values(st.granted || {}).some(Boolean)) return setState({ kind: 'connect' })
      const stats = await readStats({ days: 7, age })
      last = stats
      setState({ kind: 'data', stats })
    } catch (e) {
      setState(s => (s.kind === 'data' ? s : { kind: 'error' }))
    }
  }

  useEffect(() => { isAndroid().then(setAndroid).catch(() => {}) }, [])
  useEffect(() => {
    if (!on) return undefined
    load()
    // Back from another app (Fitbit has just synced, say): read again.
    const onShow = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onShow)
    return () => document.removeEventListener('visibilitychange', onShow)
  }, [on, age])

  if (!on || state.kind === 'none') return null

  const connect = async () => {
    try { await requestHealthRead() } catch { /* the card says what is still missing */ }
    load()
  }

  return <div className="card health-cards">
    <h2 style={{ marginBottom: 8 }}>{t('Health stats')}</h2>
    {state.kind === 'connect' && <>
      <div className="muted small" style={{ marginBottom: 10 }}>{t('Read sleep, steps, calories and heart rate from Health Connect to show them here. Nothing leaves this phone.')}</div>
      <Button variant="primary" icon="heart" onClick={connect}>{t('Connect')}</Button>
    </>}
    {state.kind === 'loading' && <div className="muted small">…</div>}
    {state.kind === 'error' && <>
      <div className="muted small" style={{ marginBottom: 10 }}>{t('Couldn’t read Health Connect.')}</div>
      <Button size="sm" onClick={load}>{t('Try again')}</Button>
    </>}
    {state.kind === 'data' && <Tiles s={summarizeStats(state.stats)} age={age} />}
  </div>
}

function Tile({ icon, tint, label, value, sub, children }) {
  return <div className="tile" style={{ background: 'var(--surface-2)' }}>
    <div className="l"><Icon name={icon} style={{ color: tint }} />{label}</div>
    <div className="v">{value}</div>
    {sub && <div className="small dim" style={{ marginTop: 3 }}>{sub}</div>}
    {children}
  </div>
}

function Tiles({ s, age }) {
  const avgOf = v => (v == null ? null : t('7-day avg {0}', n(v)))
  return <div className="tiles" style={{ marginBottom: 0 }}>
    <Tile icon="moon" tint="var(--indigo)" label={t('Sleep')} value={n(s.sleep.score)}
      sub={[s.sleep.mins != null ? fmtDur(s.sleep.mins * 60000) : null, avgOf(s.sleep.avg)].filter(Boolean).join(' · ') || t('No data')} />
    <Tile icon="steps" tint="var(--green)" label={t('Steps')} value={n(s.steps.today)} sub={avgOf(s.steps.avg)} />
    <Tile icon="flame" tint="var(--orange)" label={t('Calories')} value={n(s.calories.burned)}
      sub={s.calories.eaten != null ? t('Eaten {0}', n(s.calories.eaten)) : avgOf(s.calories.avg)} />
    <Tile icon="heart" tint="var(--red)" label={t('VO2 max')}
      value={age && s.vo2?.vo2Max != null ? fmtNum(s.vo2.vo2Max) : '–'}
      sub={!age ? null : s.vo2?.vo2Max == null ? t('Needs resting heart rate') : s.vo2.method === 'cardio-based' ? t('From cardio heart rate') : t('From resting heart rate and age')}>
      {!age && <Button size="sm" variant="tinted" style={{ marginTop: 6 }} onClick={birthYearSheet}>{t('Add your birth year')}</Button>}
    </Tile>
  </div>
}

function birthYearSheet() {
  useUI.getState().openSheet(close => <BirthYearSheet close={close} />)
}

function BirthYearSheet({ close }) {
  const S = useStore(s => s.S)
  const [year, setYear] = useState(S.birthYear ? String(S.birthYear) : '')
  const ok = ageFrom(year) != null
  const save = () => { useStore.getState().update(s => { s.birthYear = Number(year) }); close() }
  return <>
    <h3>{t('Birth year')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('VO2 max is estimated from your resting and peak heart rate and your age.')}</div>
    <TextField type="number" inputMode="numeric" placeholder="1990" value={year} onChange={e => setYear(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter' && ok) save() }} />
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={!ok} onClick={save}>{t('Save')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

/** Settings → Look & Home → On Home: the switch, beside the body weight card's. */
export function HealthCardsRow() {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [android, setAndroid] = useState(false)
  useEffect(() => { isAndroid().then(setAndroid).catch(() => {}) }, [])
  if (!MOBILE || !android) return null
  return <Row icon="heart" iconTint="var(--red)" title={t('Health stats')}
    subtitle={t('Show sleep, steps, calories and VO2 max from Health Connect on Home.')}>
    <Switch checked={shown(S)} onChange={v => update(s => { s.showHealthCards = v })} />
  </Row>
}
