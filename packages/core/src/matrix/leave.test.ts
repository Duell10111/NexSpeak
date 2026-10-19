import { describe, expect, it, vi } from 'vitest'
import type { MatrixClient, Room } from 'matrix-js-sdk'
import { FRIEND_EVENT_TYPE } from './friends'
import { leaveRoom } from './leave'

const ME = '@me:example.org'
const BOB = '@bob:example.org'
const DM = '!dm:example.org'

function fakeRoom(ownMarker: boolean | null): Room {
  return {
    roomId: DM,
    getMyMembership: () => 'join',
    currentState: {
      getStateEvents: (type: string, stateKey: string) =>
        type === FRIEND_EVENT_TYPE && stateKey === ME && ownMarker !== null
          ? { getContent: () => ({ friend: ownMarker }), getTs: () => 1 }
          : null,
    },
  } as unknown as Room
}

function setup({ ownMarker = null, direct = { [BOB]: [DM, '!other:example.org'] } }: { ownMarker?: boolean | null; direct?: Record<string, string[]> } = {}) {
  const calls: string[] = []
  const track = (name: string) => vi.fn(async () => {
    calls.push(name)
    return {}
  })
  const fake = {
    getUserId: vi.fn(() => ME),
    getRoom: vi.fn(() => fakeRoom(ownMarker)),
    getAccountData: vi.fn(() => ({ getContent: () => direct })),
    setAccountData: track('setAccountData'),
    sendStateEvent: track('sendStateEvent'),
    leave: track('leave'),
    forget: track('forget'),
  }
  return { fake, calls, client: fake as unknown as MatrixClient }
}

describe('leaveRoom', () => {
  it('leaves, drops the room from m.direct and forgets it', async () => {
    const { fake, calls, client } = setup()
    await leaveRoom(client, DM)
    expect(calls).toEqual(['leave', 'setAccountData', 'forget'])
    expect(fake.leave).toHaveBeenCalledWith(DM)
    expect(fake.setAccountData).toHaveBeenCalledWith('m.direct', { [BOB]: ['!other:example.org'] })
    expect(fake.forget).toHaveBeenCalledWith(DM)
    expect(fake.sendStateEvent).not.toHaveBeenCalled()
  })

  it('removes people without any DM left from m.direct and skips it for other rooms', async () => {
    const { fake, client } = setup({ direct: { [BOB]: [DM] } })
    await leaveRoom(client, DM)
    expect(fake.setAccountData).toHaveBeenCalledWith('m.direct', {})

    const other = setup({ direct: { [BOB]: ['!other:example.org'] } })
    await leaveRoom(other.client, DM)
    expect(other.fake.setAccountData).not.toHaveBeenCalled()
  })

  it('takes back a friendship or request before leaving', async () => {
    const { fake, calls, client } = setup({ ownMarker: true })
    await leaveRoom(client, DM)
    expect(fake.sendStateEvent).toHaveBeenCalledExactlyOnceWith(DM, FRIEND_EVENT_TYPE, { friend: false }, ME)
    expect(calls[0]).toBe('sendStateEvent')
  })

  it('still leaves when the marker or forgetting fails, but not when leaving does', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { fake, client } = setup({ ownMarker: true })
    fake.sendStateEvent.mockRejectedValueOnce(new Error('forbidden'))
    fake.forget.mockRejectedValueOnce(new Error('unknown'))
    await expect(leaveRoom(client, DM)).resolves.toBeUndefined()
    expect(fake.leave).toHaveBeenCalled()

    const failing = setup()
    failing.fake.leave.mockRejectedValueOnce(new Error('offline'))
    await expect(leaveRoom(failing.client, DM)).rejects.toThrow('offline')
    expect(failing.fake.forget).not.toHaveBeenCalled()
  })
})
