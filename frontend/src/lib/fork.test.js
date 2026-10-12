import { describe, it, expect, vi, afterEach } from 'vitest'

// OG-003: the fork has its own application id, so upstream's release APK cannot install over it.
// Under VITE_FORK=1 the update check must answer "no update" without asking GitHub.

async function loadUpdate(forkFlag) {
  vi.resetModules()
  if (forkFlag === undefined) vi.unstubAllEnvs()
  else vi.stubEnv('VITE_FORK', forkFlag)
  return import('./update.js')
}

describe('fork update guard', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = originalFetch; vi.unstubAllEnvs(); vi.resetModules() })

  it('resolves to "no update" and never calls GitHub under VITE_FORK=1', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({ tag_name: 'v99.0.0', assets: [{ name: 'opengym.apk', browser_download_url: 'https://x/a.apk' }] }),
    }))
    const { checkForUpdate } = await loadUpdate('1')
    const result = await checkForUpdate()
    expect(result).toEqual({ hasUpdate: false, latestVersion: __APP_VERSION__, apkUrl: null, hashUrl: null })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('still checks GitHub when the flag is unset', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({ tag_name: 'v99.0.0', assets: [] }),
    }))
    const { checkForUpdate } = await loadUpdate(undefined)
    const result = await checkForUpdate()
    expect(result.hasUpdate).toBe(true)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('treats any value other than "1" as unset', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ tag_name: 'v99.0.0', assets: [] }) }))
    const { checkForUpdate } = await loadUpdate('0')
    expect((await checkForUpdate()).hasUpdate).toBe(true)
  })
})
