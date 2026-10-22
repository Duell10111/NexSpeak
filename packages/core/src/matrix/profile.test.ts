import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MatrixError, MatrixEvent, SetPresence, User, type MatrixClient } from 'matrix-js-sdk'
import {
  applyStoredPresence, clearStoredPresence, loadOwnPresence, loadOwnStatus,
  setOwnPresence, setOwnStatus, statusExpiryTime, stopOwnPresence, subscribeOwnStatus,
} from './profile'
import { getUserStatus } from './presence'

const storage = new Map<string, string>()
let sequence = 0
const clients: MatrixClient[] = []
function client(userId = `@profile${++sequence}:example.org`) {
  const fake = {
    getUserId: () => userId,
    setPresence: vi.fn(async () => {}),
    setSyncPresence: vi.fn(async () => {}),
  }
  clients.push(fake as unknown as MatrixClient)
  return fake as unknown as MatrixClient & { setPresence: ReturnType<typeof vi.fn>; setSyncPresence: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  storage.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  })
  clearStoredPresence()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-22T12:00:00Z'))
})
afterEach(() => {
  clients.splice(0).forEach(stopOwnPresence)
  clearStoredPresence()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('custom status', () => {
  it('publishes interoperable text, preserves it when changing presence and clears it at one deadline', async () => {
    const own = client()
    const changed = vi.fn()
    const unsubscribe = subscribeOwnStatus(changed)
    await setOwnStatus(own, ' 🎮 In a game ', '30m')
    expect(own.setPresence).toHaveBeenLastCalledWith({ presence: 'online', status_msg: '🎮 In a game' })
    expect(loadOwnStatus(own)).toBe('🎮 In a game')
    expect(vi.getTimerCount()).toBe(1)
    await setOwnPresence(own, 'unavailable')
    expect(own.setPresence).toHaveBeenLastCalledWith({ presence: 'unavailable', status_msg: '🎮 In a game' })
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    expect(loadOwnStatus(own)).toBe('')
    expect(own.setPresence).toHaveBeenLastCalledWith({ presence: 'unavailable', status_msg: '' })
    expect(changed).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
    unsubscribe()
  })

  it('replaces expiration, creates no permanent-status timer, and supports explicit clearing', async () => {
    const own = client()
    await setOwnStatus(own, 'Temporary', '30m')
    await setOwnStatus(own, 'Permanent', 'never')
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(4 * 60 * 60_000)
    expect(loadOwnStatus(own)).toBe('Permanent')
    await setOwnStatus(own, '', 'never')
    expect(loadOwnStatus(own)).toBe('')
    expect(own.setPresence).toHaveBeenLastCalledWith({ presence: 'online', status_msg: '' })
  })

  it('cleans deadlines on disposal, clears an expired status on next login, and isolates accounts', async () => {
    const own = client()
    await setOwnStatus(own, 'Lunch', '30m')
    stopOwnPresence(own)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(own.setPresence).toHaveBeenCalledTimes(1)
    const resumed = client(own.getUserId()!)
    await applyStoredPresence(resumed)
    expect(resumed.setPresence).toHaveBeenCalledWith({ presence: 'online', status_msg: '' })
    expect(loadOwnStatus(resumed)).toBe('')
    expect(loadOwnStatus(client())).toBe('')
  })

  it('restores active status and schedules only the remaining time', async () => {
    const userId = `@stored${++sequence}:example.org`
    storage.set('nexspeak_status:' + userId, JSON.stringify({ message: 'Stored', expiresAt: Date.now() + 500 }))
    const own = client(userId)
    await applyStoredPresence(own)
    expect(loadOwnStatus(own)).toBe('Stored')
    await vi.advanceTimersByTimeAsync(500)
    expect(own.setPresence).toHaveBeenLastCalledWith({ presence: 'online', status_msg: '' })
  })

  it('does not replace a saved status when the server rejects the change', async () => {
    const own = client()
    await setOwnStatus(own, 'Saved', 'never')
    own.setPresence.mockRejectedValueOnce(new Error('Disabled presence'))
    await expect(setOwnStatus(own, 'Failed', '1h')).rejects.toThrow('Disabled presence')
    expect(loadOwnStatus(own)).toBe('Saved')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses local midnight for today and exact durations for other expiration choices', () => {
    const now = new Date(2026, 9, 22, 23, 30).getTime()
    expect(statusExpiryTime('today', now)).toBe(new Date(2026, 9, 23).getTime())
    expect(statusExpiryTime('30m', now)).toBe(now + 30 * 60_000)
    expect(statusExpiryTime('1h', now)).toBe(now + 60 * 60_000)
    expect(statusExpiryTime('4h', now)).toBe(now + 240 * 60_000)
    expect(statusExpiryTime('never', now)).toBeNull()
  })

  it('uses the raw presence event to handle cleared SDK status messages', () => {
    const user = new User('@alice:example.org')
    user.setPresenceEvent(new MatrixEvent({ type: 'm.presence', content: { presence: 'online', status_msg: 'Old status' } }))
    user.setPresenceEvent(new MatrixEvent({ type: 'm.presence', content: { presence: 'online', status_msg: '' } }))
    expect(user.presenceStatusMsg).toBe('Old status') // Current SDK retains the old field.
    expect(getUserStatus({ getUser: () => user } as unknown as MatrixClient, user.userId)).toBe('')
  })
})

describe('do not disturb', () => {
  it('stores DND locally but only ever sends online to Matrix, including on restart', async () => {
    const own = client()
    await setOwnPresence(own, 'dnd')
    expect(loadOwnPresence()).toBe('dnd')
    expect(own.setSyncPresence).toHaveBeenLastCalledWith(SetPresence.Online)
    expect(own.setPresence).toHaveBeenLastCalledWith({ presence: 'online' })
    const resumed = client(own.getUserId()!)
    await applyStoredPresence(resumed)
    expect(resumed.setPresence).toHaveBeenLastCalledWith({ presence: 'online' })
    await setOwnPresence(resumed, 'online')
    expect(loadOwnPresence()).toBe('online')
  })

  it('works locally even if the homeserver disables presence', async () => {
    const own = client()
    own.setPresence.mockRejectedValue(new Error('Presence disabled'))
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    await setOwnPresence(own, 'dnd')
    expect(loadOwnPresence()).toBe('dnd')
    await setOwnPresence(own, 'online')
    expect(loadOwnPresence()).toBe('online')
    log.mockRestore()
  })

  it('keeps the choice in memory without browser storage and resets on logout', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Blocked') }, setItem: () => { throw new Error('Blocked') }, removeItem: () => {} })
    await setOwnPresence(client(), 'dnd')
    expect(loadOwnPresence()).toBe('dnd')
    clearStoredPresence()
    expect(loadOwnPresence()).toBe('online')
  })
})

describe('presence session cancellation', () => {
  it('does not restore or start timers when disposed before initialization completes', async () => {
    const userId = `@cancelled${++sequence}:example.org`
    storage.set('nexspeak_status:' + userId, JSON.stringify({ message: 'Old', expiresAt: Date.now() + 5_000 }))
    const own = client(userId)
    stopOwnPresence(own)
    await applyStoredPresence(own)
    expect(vi.getTimerCount()).toBe(0)
    expect(own.setPresence).not.toHaveBeenCalled()
  })

  it('does not persist in-flight DND or status changes after logout', async () => {
    for (const kind of ['presence', 'status']) {
      const own = client()
      let finish!: () => void
      own.setPresence.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
      const saving = kind === 'presence' ? setOwnPresence(own, 'dnd') : setOwnStatus(own, 'Too late', '30m')
      // Run the queue and setSyncPresence promises until the network write is in flight.
      await vi.waitFor(() => expect(own.setPresence).toHaveBeenCalled())
      stopOwnPresence(own)
      clearStoredPresence()
      finish()
      await saving
      expect(loadOwnPresence()).toBe('online')
      expect(loadOwnStatus(own)).toBe('')
      expect(vi.getTimerCount()).toBe(0)
    }
  })
})

describe('presence rate limits', () => {
  const limited = (delay: number) => new MatrixError({ errcode: 'M_LIMIT_EXCEEDED', retry_after_ms: delay }, 429)

  it('waits for the homeserver retry deadline before publishing and then persists the status', async () => {
    const own = client()
    own.setPresence.mockRejectedValueOnce(limited(1_000))
    const saving = setOwnStatus(own, 'Waiting', 'never')
    await vi.advanceTimersByTimeAsync(0)
    expect(own.setPresence).toHaveBeenCalledTimes(1)
    expect(loadOwnStatus(own)).toBe('')
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(999)
    expect(own.setPresence).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await saving
    expect(own.setPresence).toHaveBeenCalledTimes(2)
    expect(loadOwnStatus(own)).toBe('Waiting')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retries expired-status clearing on startup using the same cancellable request path', async () => {
    const userId = `@limited${++sequence}:example.org`
    storage.set('nexspeak_status:' + userId, JSON.stringify({ message: 'Expired', expiresAt: Date.now() - 1 }))
    const own = client(userId)
    own.setPresence.mockRejectedValueOnce(limited(500))
    const starting = applyStoredPresence(own)
    await vi.advanceTimersByTimeAsync(0)
    expect(own.setPresence).toHaveBeenCalledTimes(1)
    expect(loadOwnStatus(own)).toBe('')
    await vi.advanceTimersByTimeAsync(500)
    await starting
    expect(own.setPresence).toHaveBeenLastCalledWith({ presence: 'online', status_msg: '' })
    expect(own.setPresence).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels retry deadlines and queued updates on logout', async () => {
    const own = client()
    own.setPresence.mockRejectedValue(limited(1_000))
    const saving = setOwnStatus(own, 'Old account', '30m')
    await vi.advanceTimersByTimeAsync(0)
    expect(own.setPresence).toHaveBeenCalledTimes(1)
    const next = setOwnPresence(own, 'dnd')
    stopOwnPresence(own)
    await Promise.all([saving, next])
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(own.setPresence).toHaveBeenCalledTimes(1)
    expect(loadOwnStatus(own)).toBe('')
    expect(loadOwnPresence()).toBe('online')
  })

  it('bounds retry attempts and refuses unreasonable server deadlines', async () => {
    const own = client()
    own.setPresence.mockRejectedValue(limited(100))
    const saving = setOwnStatus(own, 'Bounded', 'never')
    const failure = expect(saving).rejects.toMatchObject({ errcode: 'M_LIMIT_EXCEEDED' })
    await vi.runAllTimersAsync()
    await failure
    expect(own.setPresence).toHaveBeenCalledTimes(3)
    expect(loadOwnStatus(own)).toBe('')
    expect(vi.getTimerCount()).toBe(0)
    own.setPresence.mockRejectedValue(limited(60_001))
    await expect(setOwnStatus(own, 'Too far', 'never')).rejects.toMatchObject({ errcode: 'M_LIMIT_EXCEEDED' })
    expect(vi.getTimerCount()).toBe(0)
  })
})
