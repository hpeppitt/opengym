// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The same Capacitor-style plugin stand-in coach-secrets.test.js uses: a Proxy that answers
// every property, `then` included, so a bare await on it would hang (upstream issues #42, #58).
const calls = []
const backing = new Map()
const impl = {
  get: async k => (backing.has(k) ? backing.get(k) : null),
  set: async (k, v) => { backing.set(k, v) },
  remove: async k => backing.delete(k)
}
const SecureStorage = new Proxy({}, {
  get(_, prop) {
    if (prop === '$$typeof') return undefined
    if (prop === 'toJSON') return () => ({})
    return (...args) => {
      calls.push(String(prop))
      if (impl[prop]) return impl[prop](...args)
      return Promise.reject(new Error(`"SecureStorage.${String(prop)}()" is not implemented on android`))
    }
  }
})
vi.mock('@aparajita/capacitor-secure-storage', () => ({ SecureStorage }))

const gemini = await import('./gemini-key.js')
const coach = await import('./coach-secrets.js')

describe('gemini-key (OG-010)', () => {
  beforeEach(() => { calls.length = 0; backing.clear() })

  it('round-trips through the platform secure store under its own slot', async () => {
    expect(await gemini.saveGeminiKey('AIzaTestKey123')).toBe(true)
    expect([...backing.keys()]).toEqual(['anatoly.geminiKey'])
    expect(await gemini.getGeminiKey()).toBe('AIzaTestKey123')
    await gemini.clearGeminiKey()
    expect(await gemini.getGeminiKey()).toBe(null)
    expect(calls).not.toContain('then')
  })

  it('trims what was pasted', async () => {
    await gemini.saveGeminiKey('  AIzaPadded \n')
    expect(backing.get('anatoly.geminiKey')).toBe('AIzaPadded')
  })

  it('refuses an empty or blank key and leaves a saved one alone', async () => {
    await gemini.saveGeminiKey('AIzaKeep')
    expect(await gemini.saveGeminiKey('')).toBe(false)
    expect(await gemini.saveGeminiKey('   ')).toBe(false)
    expect(await gemini.saveGeminiKey(null)).toBe(false)
    expect(await gemini.getGeminiKey()).toBe('AIzaKeep')
  })

  it('never touches the AI Coach key, in either direction', async () => {
    await coach.setApiKey('sk-coach')
    await gemini.saveGeminiKey('AIzaImport')
    await gemini.clearGeminiKey()
    expect(await coach.getApiKey()).toBe('sk-coach')
    await gemini.saveGeminiKey('AIzaImport')
    await coach.clearApiKey()
    expect(await gemini.getGeminiKey()).toBe('AIzaImport')
  })
})
