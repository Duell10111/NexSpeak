import { describe, expect, it, vi } from 'vitest'
import type { MatrixClient, Room } from 'matrix-js-sdk'
import {
  FRIEND_EVENT_TYPE,
  FRIEND_REQUEST_CREATION_KEY,
  acceptFriendRequest,
  blockFriend,
  computeFriends,
  declineFriendRequest,
  friendStatus,
  removeFriend,
  sendFriendRequest,
  type Friend,
} from './friends'

const ME = '@me:example.org'
const BOB = '@bob:example.org'

interface FakeRoomOptions {
  id?: string
  membership?: 'join' | 'invite'
  partner?: string
  partnerMembership?: 'join' | 'invite'
  markers?: Record<string, { friend: boolean; ts: number }>
  friendRequest?: boolean
  lastActive?: number
}

function fakeRoom({
  id = '!dm:example.org',
  membership = 'join',
  partner = BOB,
  partnerMembership = 'join',
  markers = {},
  friendRequest = false,
  lastActive = 0,
}: FakeRoomOptions = {}): Room {
  const event = (content: Record<string, unknown>, ts = 0) => ({ getContent: () => content, getTs: () => ts })
  const getStateEvents = (type: string, stateKey?: string) => {
    if (type === 'm.room.create') return event(friendRequest ? { [FRIEND_REQUEST_CREATION_KEY]: true } : {})
    if (type !== FRIEND_EVENT_TYPE) return stateKey === undefined ? [] : null
    if (stateKey === undefined) return Object.values(markers).map((marker) => event(marker, marker.ts))
    const marker = markers[stateKey]
    return marker ? event({ friend: marker.friend }, marker.ts) : null
  }
  const joined = (membership === 'join' ? 1 : 0) + (partnerMembership === 'join' ? 1 : 0)
  const members = [{ userId: ME, membership }, { userId: partner, membership: partnerMembership }]
  return {
    roomId: id,
    isSpaceRoom: () => false,
    getMyMembership: () => membership,
    getDMInviter: () => (membership === 'invite' ? partner : undefined),
    getJoinedMemberCount: () => joined,
    getInvitedMemberCount: () => 2 - joined,
    guessDMUserId: () => partner,
    getMember: (userId: string) =>
      userId === partner ? { membership: partnerMembership, name: 'Bob', getMxcAvatarUrl: () => null } : null,
    getLastActiveTimestamp: () => lastActive,
    currentState: { getStateEvents, getMembers: () => members },
  } as unknown as Room
}

function setup(rooms: Room[] = [], ignored: string[] = []) {
  const fake = {
    getUserId: vi.fn(() => ME),
    getRooms: vi.fn(() => rooms),
    getRoom: vi.fn((roomId: string) => rooms.find((room) => room.roomId === roomId) ?? null),
    getUser: vi.fn(() => null),
    isUserIgnored: vi.fn((userId: string) => ignored.includes(userId)),
    getIgnoredUsers: vi.fn(() => ignored),
    setIgnoredUsers: vi.fn().mockResolvedValue({}),
    getAccountData: vi.fn(() => ({ getContent: () => ({ [BOB]: rooms.map((room) => room.roomId) }) })),
    setAccountData: vi.fn().mockResolvedValue({}),
    getCrypto: vi.fn(() => undefined),
    createRoom: vi.fn().mockResolvedValue({ room_id: '!new:example.org' }),
    sendStateEvent: vi.fn().mockResolvedValue({}),
    joinRoom: vi.fn(async (roomId: string) => fakeRoom({ id: roomId })),
    leave: vi.fn().mockResolvedValue({}),
    kick: vi.fn().mockResolvedValue({}),
  }
  return { fake, client: fake as unknown as MatrixClient }
}

const friendEntry = (overrides: Partial<Friend>): Friend => ({
  userId: BOB, roomId: '!dm:example.org', status: 'friend', name: 'Bob', isInvite: false, ...overrides,
})

describe('friendStatus', () => {
  const on = (ts: number) => ({ friend: true, ts })
  const off = (ts: number) => ({ friend: false, ts })

  it('needs both markers and a joined partner for a friendship', () => {
    expect(friendStatus(on(1), on(2), true)).toBe('friend')
    expect(friendStatus(on(1), on(2), false)).toBe('outgoing')
  })

  it('treats a marker without a newer answer as a pending request', () => {
    expect(friendStatus(on(1), null, false)).toBe('outgoing')
    expect(friendStatus(on(2), off(1), true)).toBe('outgoing')
    expect(friendStatus(null, on(1), true)).toBe('incoming')
    expect(friendStatus(off(1), on(2), true)).toBe('incoming')
  })

  it('ends a request or friendship with a newer `false` from either side', () => {
    expect(friendStatus(off(2), on(1), true)).toBeNull()
    expect(friendStatus(on(1), off(2), true)).toBeNull()
    expect(friendStatus(off(1), null, true)).toBeNull()
    expect(friendStatus(null, null, true)).toBeNull()
  })
})

describe('computeFriends', () => {
  it('derives friends, requests and request invites from room state', () => {
    const rooms = [
      fakeRoom({ id: '!a', partner: '@a:x', markers: { [ME]: { friend: true, ts: 1 }, '@a:x': { friend: true, ts: 2 } } }),
      fakeRoom({ id: '!b', partner: '@b:x', partnerMembership: 'invite', markers: { [ME]: { friend: true, ts: 1 } } }),
      fakeRoom({ id: '!c', partner: '@c:x', markers: { '@c:x': { friend: true, ts: 1 } } }),
      fakeRoom({ id: '!d', partner: '@d:x', membership: 'invite', friendRequest: true }),
      // A plain DM invite and a DM without markers are no friendships.
      fakeRoom({ id: '!e', partner: '@e:x', membership: 'invite' }),
      fakeRoom({ id: '!f', partner: '@f:x' }),
    ]
    const { client } = setup(rooms)
    expect(computeFriends(client).map(({ userId, roomId, status, isInvite }) => ({ userId, roomId, status, isInvite }))).toEqual([
      { userId: '@a:x', roomId: '!a', status: 'friend', isInvite: false },
      { userId: '@b:x', roomId: '!b', status: 'outgoing', isInvite: false },
      { userId: '@c:x', roomId: '!c', status: 'incoming', isInvite: false },
      { userId: '@d:x', roomId: '!d', status: 'incoming', isInvite: true },
    ])
  })

  it('keeps one entry per person, preferring a friendship, and leaves out ignored people', () => {
    const rooms = [
      fakeRoom({ id: '!request', lastActive: 9, markers: { [ME]: { friend: true, ts: 1 } } }),
      fakeRoom({ id: '!friends', lastActive: 1, markers: { [ME]: { friend: true, ts: 1 }, [BOB]: { friend: true, ts: 1 } } }),
      fakeRoom({ id: '!ignored', partner: '@troll:x', membership: 'invite', friendRequest: true }),
    ]
    const { client } = setup(rooms, ['@troll:x'])
    expect(computeFriends(client)).toEqual([expect.objectContaining({ userId: BOB, roomId: '!friends', status: 'friend' })])
  })
})

describe('sendFriendRequest', () => {
  it('creates a DM carrying the request when there is none', async () => {
    const { fake, client } = setup()
    await expect(sendFriendRequest(client, BOB)).resolves.toBe('!new:example.org')
    expect(fake.createRoom).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      preset: 'trusted_private_chat',
      is_direct: true,
      invite: [BOB],
      creation_content: { [FRIEND_REQUEST_CREATION_KEY]: true },
      initial_state: [{ type: FRIEND_EVENT_TYPE, state_key: ME, content: { friend: true } }],
    }))
    expect(fake.sendStateEvent).not.toHaveBeenCalled()
  })

  it('marks the existing DM, which also accepts their request', async () => {
    const { fake, client } = setup([fakeRoom({ markers: { [BOB]: { friend: true, ts: 1 } } })])
    await expect(sendFriendRequest(client, BOB)).resolves.toBe('!dm:example.org')
    expect(fake.createRoom).not.toHaveBeenCalled()
    expect(fake.sendStateEvent).toHaveBeenCalledExactlyOnceWith('!dm:example.org', FRIEND_EVENT_TYPE, { friend: true }, ME)
  })

  it('sends nothing while already friends or requested', async () => {
    const { fake, client } = setup([fakeRoom({ markers: { [ME]: { friend: true, ts: 1 } } })])
    await sendFriendRequest(client, BOB)
    expect(fake.sendStateEvent).not.toHaveBeenCalled()
  })

  it('renews a declined request with a newer marker', async () => {
    const { fake, client } = setup([fakeRoom({ markers: { [ME]: { friend: true, ts: 1 }, [BOB]: { friend: false, ts: 2 } } })])
    await sendFriendRequest(client, BOB)
    expect(fake.sendStateEvent.mock.calls.map((call) => call[2])).toEqual([{ friend: false }, { friend: true }])
  })
})

describe('answering and ending', () => {
  it('accepts a request invite by joining, remembering the DM and marking it', async () => {
    const { fake, client } = setup()
    await acceptFriendRequest(client, friendEntry({ status: 'incoming', isInvite: true }))
    expect(fake.joinRoom).toHaveBeenCalledWith('!dm:example.org')
    expect(fake.setAccountData).toHaveBeenCalledWith('m.direct', { [BOB]: ['!dm:example.org'] })
    expect(fake.sendStateEvent).toHaveBeenCalledExactlyOnceWith('!dm:example.org', FRIEND_EVENT_TYPE, { friend: true }, ME)
  })

  it('declines a request invite by rejecting it and one in a DM with `false`', async () => {
    const { fake, client } = setup()
    await declineFriendRequest(client, friendEntry({ status: 'incoming', isInvite: true }))
    expect(fake.leave).toHaveBeenCalledWith('!dm:example.org')
    expect(fake.sendStateEvent).not.toHaveBeenCalled()

    await declineFriendRequest(client, friendEntry({ status: 'incoming' }))
    expect(fake.sendStateEvent).toHaveBeenCalledExactlyOnceWith('!dm:example.org', FRIEND_EVENT_TYPE, { friend: false }, ME)
  })

  it('revokes the invite when cancelling a request that created the DM', async () => {
    const { fake, client } = setup([fakeRoom({ partnerMembership: 'invite', friendRequest: true })])
    await removeFriend(client, friendEntry({ status: 'outgoing' }))
    expect(fake.sendStateEvent).toHaveBeenCalledWith('!dm:example.org', FRIEND_EVENT_TYPE, { friend: false }, ME)
    expect(fake.kick).toHaveBeenCalledWith('!dm:example.org', BOB)
  })

  it('keeps the DM when removing a friend', async () => {
    const { fake, client } = setup([fakeRoom({ friendRequest: true })])
    await removeFriend(client, friendEntry({ status: 'friend' }))
    expect(fake.sendStateEvent).toHaveBeenCalledTimes(1)
    expect(fake.kick).not.toHaveBeenCalled()
    expect(fake.leave).not.toHaveBeenCalled()
  })

  it('blocking ends the friendship and ignores the person', async () => {
    const { fake, client } = setup([fakeRoom()])
    await blockFriend(client, friendEntry({ status: 'friend' }))
    expect(fake.sendStateEvent).toHaveBeenCalledWith('!dm:example.org', FRIEND_EVENT_TYPE, { friend: false }, ME)
    expect(fake.setIgnoredUsers).toHaveBeenCalledWith([BOB])
  })
})
