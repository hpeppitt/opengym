// Merge a custom exercise into a library one (fork OG-025): for history imported as custom
// exercises the catalogue already has. Two ways in, each hooked into upstream by one line:
// Settings → Data & backup → Bring data in lists every custom exercise, and a custom exercise's
// detail sheet has a Merge button. The merge itself is lib/merge-exercise.js.
import { t } from '../../lib/i18n.js'
import { exerciseNameText } from '../../lib/format.js'
import { exOr } from '../../lib/exercises.js'
import { exerciseUsage, mergeBlocker, mergeExercise, mergeSuggestions } from '../../lib/merge-exercise.js'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { Button, Row } from '../ui.jsx'
import { confirmSheet, exercisePicker } from '../../sheets.jsx'

const toast = m => useUI.getState().toast(m)
const openSheet = render => useUI.getState().openSheet(render)
const nameOf = ex => exerciseNameText(ex)
const workoutsText = n => (n === 1 ? t('1 workout') : t('{0} workouts', n))
const slotsText = n => (n === 1 ? t('1 routine slot') : t('{0} routine slots', n))
const customs = S => (S.customEx || []).filter(c => c && c.id)
// Up to three library exercises whose names look like this one, the closest first.
const suggestions = ex => mergeSuggestions(ex.n).map(id => exOr(id)).filter(Boolean)

const BLOCKED = {
  mode: () => t('Pick an exercise logged the same way (weight and reps, time, or cardio)'),
  active: () => t('Finish your current workout first'),
  same: () => t('Pick a different exercise'),
}

/** Asks, then merges `from` into `to`. `onDone` runs after the merge. */
export function confirmMerge(from, to, onDone) {
  const S = useStore.getState().S
  const blocked = mergeBlocker(S, from, to)
  if (blocked) return toast((BLOCKED[blocked] || BLOCKED.same)())
  const { workouts, routines } = exerciseUsage(S, from.id)
  confirmSheet({
    title: t('Merge “{0}” into “{1}”?', nameOf(from), nameOf(to)),
    message: t('{0} and {1} move to “{2}”, and “{3}” is deleted. This cannot be undone.', workoutsText(workouts), slotsText(routines), nameOf(to), nameOf(from)),
    confirmText: t('Merge'),
    onConfirm: () => {
      useStore.getState().update(s => { mergeExercise(s, from.id, to.id) })
      toast(t('Merged into “{0}”', nameOf(to)))
      onDone && onDone()
    },
  })
}

/** The sheet for one custom exercise: suggested library matches, or search the whole library. */
export function mergeExerciseSheet(ex, onDone) {
  openSheet(close => <MergeOneSheet ex={ex} close={close} onDone={onDone} />)
}

function MergeOneSheet({ ex, close, onDone }) {
  const S = useStore(s => s.S)
  const { workouts } = exerciseUsage(S, ex.id)
  const done = () => { close(); onDone && onDone() }
  const search = () => {
    const h = exercisePicker(to => { h?.close?.(); confirmMerge(ex, to, done) }, { title: t('Merge into'), like: ex.id })
  }
  const near = suggestions(ex)
  return <>
    <h3>{t('Merge “{0}”', nameOf(ex))}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {t('Its history ({0}), routine slots and settings move to the exercise you pick, and this custom exercise is deleted.', workoutsText(workouts))}
    </div>
    {near.length > 0 && <h4 className="sec">{t('Suggested')}</h4>}
    {near.map(to => <Row key={to.id} icon="merge" iconTint="var(--blue)" title={nameOf(to)} accessory="chevron"
      onClick={() => confirmMerge(ex, to, done)} />)}
    <div style={{ height: 10 }} />
    <Button icon="magnifier" onClick={search}>{t('Search the library')}</Button>
  </>
}

/** Settings → Bring data in: every custom exercise, most logged first. Hidden when there are none. */
export function MergeExercisesRow() {
  const n = useStore(s => customs(s.S).length)
  if (!n) return null
  return <Row icon="merge" iconTint="var(--teal)" title={t('Merge custom exercises')}
    subtitle={t('{0} custom exercises. Map them onto the library.', n)}
    accessory="chevron" onClick={() => openSheet(close => <MergeListSheet close={close} />)} />
}

function MergeListSheet({ close }) {
  const S = useStore(s => s.S)
  const list = customs(S)
    .map(ex => ({ ex, used: exerciseUsage(S, ex.id), near: suggestions(ex)[0] }))
    .sort((a, b) => b.used.workouts - a.used.workouts || nameOf(a.ex).localeCompare(nameOf(b.ex)))
  return <>
    <h3>{t('Merge custom exercises')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {t('Tap one to move its history onto a library exercise.')}
    </div>
    {list.length === 0 && <div className="small dim" style={{ marginBottom: 12 }}>{t('No custom exercises left.')}</div>}
    {list.map(({ ex, used, near }) => <Row key={ex.id} icon="dumbbell" iconTint="var(--blue)" title={nameOf(ex)}
      subtitle={[workoutsText(used.workouts), near ? t('Closest: {0}', nameOf(near)) : null].filter(Boolean).join(' · ')}
      accessory="chevron" onClick={() => mergeExerciseSheet(ex)} />)}
    <div style={{ height: 10 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Done')}</Button>
  </>
}

/** The detail sheet's button for a custom exercise. */
export function MergeExerciseButton({ ex, close }) {
  return <Button icon="merge" style={{ marginTop: 8 }} onClick={() => mergeExerciseSheet(ex, close)}>{t('Merge into another exercise')}</Button>
}
