import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MatrixSession } from './storage'

const KEY = 'nexspeak_matrix_session'
const session: MatrixSession = {
  homeserverUrl: 'https://matrix.example.org',
  userId: '@alice:example.org',
  accessToken: 'test-token',
  deviceId: 'TESTDEVICE',
}

beforeEach(() => {
  vi.resetModules()
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('session storage snapshots', () => {
  it('keeps the same object for unchanged valid data and clears it after logout', async () => {
    const { loadSession, saveSession, clearSession } = await import('./storage')
    expect(loadSession()).toBeNull()
    saveSession(session)
    const loaded = loadSession()
    expect(loaded).toEqual(session)
    expect(loadSession()).toBe(loaded)
    clearSession()
    expect(loadSession()).toBeNull()
    expect(loadSession()).toBeNull()
  })

  it('never restores a previously cached session after malformed JSON', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { loadSession, saveSession } = await import('./storage')
    saveSession(session)
    expect(loadSession()).toEqual(session)
    localStorage.setItem(KEY, '{')
    expect(loadSession()).toBeNull()
    expect(loadSession()).toBeNull()
    expect(loadSession()).toBeNull()
    expect(console.error).toHaveBeenCalledOnce()

    const nextSession = { ...session, userId: '@bob:example.org', accessToken: 'next-token' }
    saveSession(nextSession)
    expect(loadSession()).toEqual(nextSession)
  })

  it('returns stable null snapshots for malformed or structurally invalid initial data', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { loadSession } = await import('./storage')
    for (const raw of ['{', 'null', '{}', JSON.stringify({ ...session, accessToken: '' })]) {
      localStorage.setItem(KEY, raw)
      expect(loadSession()).toBeNull()
      expect(loadSession()).toBeNull()
    }
  })
})
