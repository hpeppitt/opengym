// Settings → Data & backup → Bring data in: the Gemini API key the Anatoly program import uses
// (fork OG-010). Phone builds only; hooked into upstream's Settings by one line. The key lives in
// secure storage (lib/gemini-key.js); in this component it only passes through the sheet's field,
// which is cleared when the sheet goes away.
import { useEffect, useRef, useState } from 'react'
import { t } from '../../lib/i18n.js'
import { getGeminiKey, saveGeminiKey, clearGeminiKey, GEMINI_KEY_URL } from '../../lib/gemini-key.js'
import { useUI } from '../../store/useUI.js'
import { Row, Button, TextField } from '../ui.jsx'

export default function GeminiKeyRow() {
  const [hasKey, setHasKey] = useState(null)
  const refresh = () => getGeminiKey().then(k => setHasKey(!!k)).catch(() => setHasKey(false))
  useEffect(() => { refresh() }, [])

  const open = () => useUI.getState().openSheet(close => <GeminiKeySheet close={close} hasKey={!!hasKey} onChange={refresh} />)

  return <Row icon="key" iconTint="var(--teal)" title={t('Gemini API key')}
    subtitle={hasKey ? t('Saved on this phone') : t('Needed to import workout screenshots')}
    accessory="chevron" onClick={open} />
}

function GeminiKeySheet({ close, hasKey, onChange }) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const keyRef = useRef(null)
  useEffect(() => () => { setKey('') }, [])
  const toast = msg => useUI.getState().toast(msg)

  const save = async () => {
    if (!key.trim()) return toast(t('Enter your API key'))
    setBusy(true)
    try {
      await saveGeminiKey(key)
      setKey(''); if (keyRef.current) keyRef.current.value = ''
      await onChange()
      toast(t('Gemini key saved'))
      close()
    } finally { setBusy(false) }
  }
  const remove = async () => {
    setBusy(true)
    try {
      await clearGeminiKey()
      await onChange()
      toast(t('Gemini key removed'))
      close()
    } finally { setBusy(false) }
  }

  return <>
    <h3>{t('Gemini API key')}</h3>
    <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.5 }}>
      {t('Used to read workout screenshots for import. It stays in this phone’s secure storage and is never included in backups or sync.')}
    </div>
    <TextField ref={keyRef} type="password" autoComplete="off" spellCheck={false}
      placeholder={hasKey ? '••••••••••••' : 'AIza…'} value={key} disabled={busy}
      onChange={e => setKey(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter' && !busy) save() }} />
    <div className="small" style={{ margin: '10px 0 16px', lineHeight: 1.45 }}>
      <a href={GEMINI_KEY_URL} target="_blank" rel="noopener noreferrer">{t('Get a key in Google AI Studio')}</a>
    </div>
    <Button variant="primary" onClick={save} disabled={busy || !key.trim()}>{t('Save')}</Button>
    {hasKey && <>
      <div style={{ height: 8 }} />
      <Button variant="ghost" className="danger" onClick={remove} disabled={busy}>{t('Remove key')}</Button>
    </>}
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close} disabled={busy}>{t('Cancel')}</Button>
  </>
}
