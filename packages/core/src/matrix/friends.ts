/**
 * Friends like on Discord. Matrix has no friends concept, so friendship is a marker inside the
 * 1:1 DM room that both sides see: the state event `io.nexspeak.friend` with the sender's user ID
 * as state key (only that user may send it) and the content `{ friend: true | false }`.
 *
 * - Friends: both are joined and both events say `true`.
 * - Pending request: one side says `true`, the other has no event or an older one. A newer
 *   `false` from the other side declines it (or ends the friendship), so it isn't pending.
 * - A request to someone without a DM creates the room with the own event and a marker in
 *   `m.room.create`, which homeservers show to the invitee before joining.
 */

import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk'
import { createDirectRoom, findDirectRoom, rememberDirectRoom } from './direct'
import { setIgnored } from './safety'

export const FRIEND_EVENT_TYPE = 'io.nexspeak.friend'
export const FRIEND_REQUEST_CREATION_KEY = 'io.nexspeak.friend_request'

export type FriendStatus = 'friend' | 'incoming' | 'outgoing'

export interface Friend {
  userId: string
  /** The DM room carrying the friendship (an invite for requests without a DM yet). */
  roomId: string
  status: FriendStatus
  name: string
  avatarMxc?: string
  /** We are only invited to the room: a new request from someone without a DM. */
  isInvite: boolean
}

export interface FriendMarker {
  friend: boolean
  ts: number
}

const STATUS_PRIORITY: Record<FriendStatus, number> = { friend: 0, incoming: 1, outgoing: 2 }

/** The friendship between us and the other side of a DM, from both markers. */
export function friendStatus(own: FriendMarker | null, other: FriendMarker | null, otherJoined: boolean): FriendStatus | null {
  if (own?.friend && other?.friend) return otherJoined ? 'friend' : 'outgoing'
  if (own?.friend && (!other || other.ts < own.ts)) return 'outgoing'
  if (other?.friend && otherJoined && (!own || own.ts < other.ts)) return 'incoming'
  return null
}

function readMarker(room: Room, userId: string): FriendMarker | null {
  const event: MatrixEvent | null = room.currentState.getStateEvents(FRIEND_EVENT_TYPE, userId)
  if (!event) return null
  return { friend: event.getContent().friend === true, ts: event.getTs() }
}

/** An invite to a room that was created for a friend request (visible before joining). */
export function isFriendRequestInvite(room: Room): boolean {
  if (room.getMyMembership() !== 'invite') return false
  const create = room.currentState.getStateEvents('m.room.create', '')
  return create?.getContent()[FRIEND_REQUEST_CREATION_KEY] === true
}

/** The other person of a 1:1 room and whether they joined, or null for any other room. */
function directPartner(client: MatrixClient, room: Room): { userId: string; joined: boolean } | null {
  const ownId = client.getUserId()
  if (room.getJoinedMemberCount() + room.getInvitedMemberCount() !== 2) return null
  const userId = room.guessDMUserId()
  if (!userId || userId === ownId) return null
  const membership = room.getMember(userId)?.membership
  if (membership && membership !== 'join' && membership !== 'invite') return null
  return { userId, joined: membership ? membership === 'join' : room.getJoinedMemberCount() === 2 }
}

function profileOf(client: MatrixClient, room: Room, userId: string): { name: string; avatarMxc?: string } {
  const member = room.getMember(userId)
  const user = client.getUser(userId)
  return {
    name: member?.name || user?.displayName || userId,
    avatarMxc: member?.getMxcAvatarUrl() || user?.avatarUrl || undefined,
  }
}

function friendInRoom(client: MatrixClient, room: Room): Friend | null {
  const ownId = client.getUserId()
  if (!ownId || room.isSpaceRoom()) return null
  const membership = room.getMyMembership()

  if (membership === 'invite') {
    const inviter = room.getDMInviter()
    if (!inviter || !isFriendRequestInvite(room)) return null
    return { userId: inviter, roomId: room.roomId, status: 'incoming', isInvite: true, ...profileOf(client, room, inviter) }
  }
  if (membership !== 'join') return null
  // Cheap check first: most rooms never carry a marker.
  if (room.currentState.getStateEvents(FRIEND_EVENT_TYPE).length === 0) return null

  const partner = directPartner(client, room)
  if (!partner) return null
  const status = friendStatus(readMarker(room, ownId), readMarker(room, partner.userId), partner.joined)
  if (!status) return null
  return { userId: partner.userId, roomId: room.roomId, status, isInvite: false, ...profileOf(client, room, partner.userId) }
}

/**
 * Friends and pending requests from the synced room state, one entry per person (a friendship
 * wins over a request if several DMs exist). Ignored people are left out.
 */
export function computeFriends(client: MatrixClient, rooms: Room[] = client.getRooms()): Friend[] {
  const byUser = new Map<string, { friend: Friend; activity: number }>()
  rooms.forEach((room) => {
    const friend = friendInRoom(client, room)
    if (!friend || client.isUserIgnored(friend.userId)) return
    const activity = room.getLastActiveTimestamp()
    const current = byUser.get(friend.userId)
    const better =
      !current ||
      STATUS_PRIORITY[friend.status] < STATUS_PRIORITY[current.friend.status] ||
      (friend.status === current.friend.status && activity > current.activity)
    if (better) byUser.set(friend.userId, { friend, activity })
  })
  return Array.from(byUser.values(), (entry) => entry.friend).sort((a, b) => a.name.localeCompare(b.name))
}

// sendStateEvent is typed per known event type; ours is custom.
type LooseStateSender = (roomId: string, type: string, content: Record<string, unknown>, stateKey: string) => Promise<unknown>

async function setMarker(client: MatrixClient, roomId: string, friend: boolean): Promise<void> {
  const ownId = client.getUserId()
  if (!ownId) throw new Error('Not logged in')
  await (client.sendStateEvent as unknown as LooseStateSender).call(client, roomId, FRIEND_EVENT_TYPE, { friend }, ownId)
}

/**
 * Sends a friend request (or accepts theirs) in the DM with this person; without a DM, creates
 * one as a request. Returns the DM room.
 */
export async function sendFriendRequest(client: MatrixClient, userId: string): Promise<string> {
  const ownId = client.getUserId()
  if (!ownId) throw new Error('Not logged in')
  const room = findDirectRoom(client, userId)
  if (!room) {
    return createDirectRoom(client, [userId], {
      initialState: [{ type: FRIEND_EVENT_TYPE, state_key: ownId, content: { friend: true } }],
      creationContent: { [FRIEND_REQUEST_CREATION_KEY]: true },
    })
  }

  const own = readMarker(room, ownId)
  const partner = directPartner(client, room)
  const status = friendStatus(own, readMarker(room, userId), partner?.joined ?? false)
  if (status === 'friend' || status === 'outgoing') return room.roomId
  // A declined or ended request still says `true`; homeservers drop state identical to the
  // current one, so take it back first to get a newer marker.
  if (own?.friend) await setMarker(client, room.roomId, false)
  await setMarker(client, room.roomId, true)
  return room.roomId
}

export async function acceptFriendRequest(client: MatrixClient, friend: Friend): Promise<void> {
  if (friend.isInvite) {
    const room = await client.joinRoom(friend.roomId)
    await rememberDirectRoom(client, room, friend.userId).catch((error: unknown) => console.warn('Updating m.direct failed:', error))
  }
  await setMarker(client, friend.roomId, true)
}

/** Declines an incoming request; a request that came as an invite is rejected (no DM). */
export async function declineFriendRequest(client: MatrixClient, friend: Friend): Promise<void> {
  if (friend.isInvite) {
    await client.leave(friend.roomId)
    return
  }
  await setMarker(client, friend.roomId, false)
}

/**
 * Cancels an outgoing request or ends a friendship for both sides; the DM stays. A request that
 * created the DM and is still unanswered also revokes the invite, so it disappears for them.
 */
export async function removeFriend(client: MatrixClient, friend: Friend): Promise<void> {
  await setMarker(client, friend.roomId, false)
  if (friend.status !== 'outgoing') return
  const room = client.getRoom(friend.roomId)
  const create = room?.currentState.getStateEvents('m.room.create', '')
  if (create?.getContent()[FRIEND_REQUEST_CREATION_KEY] === true && room?.getMember(friend.userId)?.membership === 'invite') {
    await client.kick(friend.roomId, friend.userId)
  }
}

/** Ends the friendship or request and ignores the person (no messages, invites or requests). */
export async function blockFriend(client: MatrixClient, friend: Friend): Promise<void> {
  if (friend.status === 'incoming') await declineFriendRequest(client, friend)
  else await removeFriend(client, friend)
  await setIgnored(client, friend.userId, true)
}
