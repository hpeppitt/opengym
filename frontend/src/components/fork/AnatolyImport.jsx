// Plan → Import: an Anatoly session from photos, reviewed, saved as a routine pinned to its day
// (fork OG-013). Phone builds only; hooked into upstream's Plan header by one line.
//
//   pick photos + day  ->  lib/anatoly-import.js (Gemini)  ->  lib/anatoly-match.js
//   ->  review: every fuzzy row is confirmed or changed before Save
//   ->  lib/anatoly-routine.js: one routine per day, pinned via dayPlan, tidied once the day passes
import { useEffect, useRef, useState } from 'react'
import { t } from '../../lib/i18n.js'
import { MOBILE } from '../../lib/mobile.js'
import { todayISO, fmtDate, exerciseNameText } from '../../lib/format.js'
import { exOr, EXIDX } from '../../lib/exercises.js'
import { deleteRoutine } from '../../lib/routines.js'
import { getGeminiKey } from '../../lib/gemini-key.js'
import { importFromImages } from '../../lib/anatoly-import.js'
import { matchRows, resolveRows } from '../../lib/anatoly-match.js'
import { buildRoutine, saveImportedSession, staleImportedRoutines, tidyImportedRoutines } from '../../lib/anatoly-routine.js'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { Button, Row, SelectRow } from '../ui.jsx'
import { toImage } from './anatoly-images.js'

export default function AnatolyImportButton() {
  // Past days' imported routines go when Plan opens; the workouts logged from them stay.
  useEffect(() => {
    const today = todayISO()
    if (staleImportedRoutines(useStore.getState().S, today).length) useStore.getState().update(s => { tidyImportedRoutines(s, today, deleteRoutine) })
  }, [])
  if (!MOBILE) return null
  return <Button size="sm" variant="tinted" icon="camera" aria-label={t('Import a session from photos')} onClick={openAnatolyImport}>{t('Import')}</Button>
}

export function openAnatolyImport() {
  useUI.getState().openSheet(close => <AnatolyImportSheet close={close} />)
}

const ERRORS = {
  'no-key': () => t('Save your Gemini API key in Settings first'),
  'no-images': () => t('Pick at least one photo'),
  auth: () => t('Gemini refused the API key. Check it in Settings.'),
  network: () => t('Couldn’t reach Gemini. Check your connection and try again.'),
  'max-tokens': () => t('Gemini’s answer was cut off. Try fewer photos at once.'),
  truncated: () => t('Gemini’s answer was cut off. Try fewer photos at once.'),
  unparseable: () => t('Gemini’s answer was cut off. Try fewer photos at once.'),
  unreadable: () => t('Gemini couldn’t read the photos. Try clearer or brighter ones.'),
  empty: () => t('No exercises found in the photos. Make sure they show sets and reps.'),
}
const errorText = e => (ERRORS[e?.code] || (() => t('Gemini couldn’t read a session from the photos. Try again.')))()

// "4 × 6–8 · 100 kg", "3 × 0:45", "1 × Time: Max": what the photo asked for, as read.
function rowSummary(r) {
  const sets = r.sets ?? '–'
  const what = r.reps != null ? (r.repsMax ? `${r.reps}–${r.repsMax}` : String(r.reps))
    : r.timeSeconds != null ? `${Math.floor(r.timeSeconds / 60)}:${String(r.timeSeconds % 60).padStart(2, '0')}`
      : (r.notes || '–')
  const load = r.targetWeight != null ? ` · ${r.targetWeight}${r.weightUnit ? ' ' + r.weightUnit : ''}` : ''
  return `${sets} × ${what}${load}`
}

const CUSTOM = 'custom'
const nameOf = id => exerciseNameText(exOr(id))

function AnatolyImportSheet({ close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const today = todayISO()
  const fileRef = useRef(null)
  const [files, setFiles] = useState([])
  const [date, setDate] = useState(today)
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState(null)        // matched rows, once read
  const [choice, setChoice] = useState([])      // per row: an exercise id, or CUSTOM
  const [ok, setOk] = useState([])              // per row: confirmed
  const toast = msg => useUI.getState().toast(msg)

  const read = async () => {
    setBusy(true)
    try {
      const key = await getGeminiKey()
      const images = await Promise.all(files.map(toImage))
      const matched = matchRows(await importFromImages(key, images), { customEx: S.customEx || [] })
      setRows(matched)
      setChoice(matched.map(r => (r.status === 'unmatched' ? CUSTOM : r.exerciseId)))
      setOk(matched.map(r => r.status !== 'fuzzy'))
    } catch (e) {
      toast(errorText(e))
    } finally { setBusy(false) }
  }

  const choose = (i, v) => { setChoice(c => c.map((x, j) => (j === i ? v : x))); setOk(o => o.map((x, j) => (j === i ? true : x))) }
  const confirm = i => setOk(o => o.map((x, j) => (j === i ? true : x)))
  const toCheck = ok.filter(x => !x).length

  const save = () => {
    const reviewed = rows.map((r, i) => (choice[i] === CUSTOM
      ? { ...r, accepted: false }
      : { ...r, exerciseId: choice[i], exerciseName: EXIDX[choice[i]]?.n ?? r.exerciseName, accepted: true }))
    const resolved = resolveRows(reviewed, { customEx: S.customEx || [] })
    const routine = buildRoutine(resolved.rows, { name: 'Anatoly · ' + fmtDate(date), date, unit: S.unit || 'kg' })
    update(s => { saveImportedSession(s, routine, { customEx: resolved.customEx, iso: date, deleteRoutine }) })
    toast(t('Session saved for {0}', fmtDate(date, true)))
    close()
  }

  if (!rows) {
    return <>
      <h3>{t('Import a session from photos')}</h3>
      <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.5 }}>
        {t('Pick screenshots or photos of one session. Gemini reads the exercises, sets, reps and weights, and you check every row before anything is saved.')}
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden
        onChange={e => { setFiles([...e.target.files]); e.target.value = '' }} />
      <Row icon="image" iconTint="var(--teal)" title={t('Choose photos')}
        value={files.length ? t('Photos: {0}', files.length) : null} accessory="chevron"
        onClick={() => !busy && fileRef.current?.click()} />
      <Row icon="calendar" iconTint="var(--orange)" title={t('Day')}>
        <input type="date" className="timef" value={date} min={today} disabled={busy}
          onChange={e => setDate(e.target.value >= today ? e.target.value : today)} />
      </Row>
      <div style={{ height: 16 }} />
      <Button variant="primary" onClick={read} disabled={busy || !files.length}>
        {busy ? t('Reading the photos…') : t('Read photos')}
      </Button>
      <div style={{ height: 8 }} />
      <Button variant="ghost" className="dim" onClick={close} disabled={busy}>{t('Cancel')}</Button>
    </>
  }

  return <>
    <h3>{t('Check the session')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{fmtDate(date, true)}</div>
    {rows.map((r, i) => {
      const options = [
        ...(r.candidates || []).map(c => ({ value: c.id, label: nameOf(c.id) })),
        ...(r.exerciseId && !(r.candidates || []).some(c => c.id === r.exerciseId) ? [{ value: r.exerciseId, label: EXIDX[r.exerciseId] ? nameOf(r.exerciseId) : r.exerciseName }] : []),
        { value: CUSTOM, label: t('New exercise: {0}', r.sourceText) },
      ]
      const tag = choice[i] === CUSTOM ? t('New exercise') : ok[i] ? t('Matched') : t('Check')
      return <div key={i} className="anatoly-row" style={{ marginBottom: 12 }}>
        <div className="row between">
          <strong>{r.sourceText}</strong>
          <span className={'tag' + (ok[i] ? '' : ' acc')}>{tag}</span>
        </div>
        <div className="small dim" style={{ margin: '2px 0 4px' }}>{rowSummary(r)}</div>
        <SelectRow icon="dumbbell" iconTint="var(--blue)" title={t('Exercise')} value={choice[i]}
          options={options} onChange={v => choose(i, v)} stackedValue />
        {!ok[i] && <Button size="sm" variant="tinted" icon="check" onClick={() => confirm(i)}>{t('Looks right')}</Button>}
      </div>
    })}
    {toCheck > 0 && <div className="small dim" style={{ margin: '4px 0 10px' }}>{t('Rows to check: {0}', toCheck)}</div>}
    <Button variant="primary" onClick={save} disabled={toCheck > 0}>{t('Save session')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={() => setRows(null)}>{t('Back')}</Button>
  </>
}
