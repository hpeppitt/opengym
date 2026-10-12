// The Gemini API key for the Anatoly program import (fork OG-010, docs/fork/BACKLOG.md).
//
// Its own slot in the phone's secure storage, beside the AI Coach's key and never shared with
// it: the import works whatever the Coach is set to, and turning the Coach off does not forget
// the import key. Storage, timeouts and fallbacks are upstream's lib/coach-secrets.js, so the
// key gets exactly the treatment the Coach's own key gets: never in S, never in localStorage,
// never in a backup or a sync.
import { secureGet, secureSet, secureRemove } from './coach-secrets.js'

export const GEMINI_KEY_SLOT = 'anatoly.geminiKey'
export const GEMINI_KEY_URL = 'https://aistudio.google.com/apikey'

export const getGeminiKey = () => secureGet(GEMINI_KEY_SLOT)

/** Saves the trimmed key. Returns false, and stores nothing, for an empty or blank one. */
export async function saveGeminiKey(raw) {
  const key = String(raw ?? '').trim()
  if (!key) return false
  await secureSet(GEMINI_KEY_SLOT, key)
  return true
}

export const clearGeminiKey = () => secureRemove(GEMINI_KEY_SLOT)
