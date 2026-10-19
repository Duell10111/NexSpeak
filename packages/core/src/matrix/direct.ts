/**
 * Direct messages and inviting people: starting DMs (m.direct bookkeeping like Element),
 * finding users, and inviting them to a space together with its channels.
 */

import { EventType, JoinRule, Preset, type MatrixClient, type Room } from 'matrix-js-sdk'

export interface UserSearchResult {
  userId: string
  displayName: string
  avatarMxc?: string
}

const FULL_USER_ID = /^@[^:\s]+:\S+$/

export function isFullUserId(value: string): boolean {
  return FULL_USER_ID.test(value.trim())
}

/** Room ids per user from m.direct, as stored in the account data. */
function readDirectMap(client: MatrixClient): Record<string, string[]> {
  const content = client.getAccountData(EventType.Direct)?.getContent() ?? {}
  return Object.fromEntries(
    Object.entries(content).map(([userId, ids]) => [userId, Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []]),
  )
}

export function getDirectRoomIds(client: MatrixClient): Set<string> {
  return new Set(Object.values(readDirectMap(client)).flat())
}

/** Whether a room is marked as a DM: listed in m.direct or joined via a DM invite. */
export function isDirectRoom(client: MatrixClient, room: Room, directIds = getDirectRoomIds(client)): boolean {
  return !room.isSpaceRoom() && (directIds.has(room.roomId) || Boolean(room.getDMInviter()))
}

/** Fallback for rooms without m.direct entry: a 1:1 room without address is most likely a DM. */
export function looksLikeDirectRoom(client: MatrixClient, room: Room): boolean {
  const userId = client.getUserId()
  const joined = room.getJoinedMembers()
  return (
    Boolean(userId) &&
    joined.length === 2 &&
    joined.some((member) => member.userId === userId) &&
    !room.getCanonicalAlias()
  )
}

async function addDirectRoom(client: MatrixClient, userIds: string[], roomId: string): Promise<void> {
  const map = readDirectMap(client)
  let changed = false
  userIds.forEach((userId) => {
    const ids = map[userId] ?? []
    if (!ids.includes(roomId)) {
      map[userId] = [...ids, roomId]
      changed = true
    }
  })
  if (changed) await client.setAccountData(EventType.Direct, map)
}

/** An existing 1:1 DM with this user that both of us are (or will be) in. */
export function findDirectRoom(client: MatrixClient, userId: string): Room | null {
  const ownId = client.getUserId()
  const candidates = (readDirectMap(client)[userId] ?? [])
    .map((roomId) => client.getRoom(roomId))
    .filter((room): room is Room => Boolean(room && room.getMyMembership() === 'join'))
    .filter((room) => {
      const others = room.currentState.getMembers().filter((member) => member.userId !== ownId)
      const membership = room.getMember(userId)?.membership
      return others.length === 1 && (membership === 'join' || membership === 'invite')
    })
  return candidates.sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp())[0] ?? null
}

async function canEncryptTo(client: MatrixClient, userIds: string[]): Promise<boolean> {
  const crypto = client.getCrypto()
  if (!crypto) return false
  try {
    const devices = await crypto.getUserDeviceInfo(userIds, true)
    // Like Element: only encrypt when everybody has a device that can receive keys.
    return userIds.every((userId) => (devices.get(userId)?.size ?? 0) > 0)
  } catch {
    return false
  }
}

export interface DirectRoomExtras {
  /** Additional state events for the new room. */
  initialState?: Array<{ type: string; state_key: string; content: Record<string, unknown> }>
  /** Extra `m.room.create` content; homeservers show it to invitees before they join. */
  creationContent?: Record<string, unknown>
}

/**
 * Creates a new DM room with these users (encrypted when possible) and records it in m.direct.
 * Trusted private chat: the invitees get the same power level, so both sides may send state.
 */
export async function createDirectRoom(client: MatrixClient, userIds: string[], extras: DirectRoomExtras = {}): Promise<string> {
  const encrypted = await canEncryptTo(client, userIds)
  const { room_id: roomId } = await client.createRoom({
    preset: Preset.TrustedPrivateChat,
    is_direct: true,
    invite: userIds,
    creation_content: extras.creationContent,
    initial_state: [
      ...(encrypted
        ? [{ type: EventType.RoomEncryption, state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } }]
        : []),
      ...(extras.initialState ?? []),
    ],
  })
  await addDirectRoom(client, userIds, roomId)
  return roomId
}

/** Open the DM with these users: reuses an existing 1:1 DM, otherwise creates a new room. */
export async function startDirectMessage(client: MatrixClient, userIds: string[]): Promise<string> {
  if (userIds.length === 1) {
    const existing = findDirectRoom(client, userIds[0])
    if (existing) return existing.roomId
  }
  return createDirectRoom(client, userIds)
}

/** After accepting an invite that was sent as a DM, remember it as one. */
export async function rememberDirectRoom(client: MatrixClient, room: Room, inviter: string | undefined): Promise<void> {
  if (!inviter) return
  await addDirectRoom(client, [inviter], room.roomId)
}

/**
 * Search the user directory. Homeservers usually only return people sharing a room with us,
 * so a full user ID that isn't found is offered as well (with its profile, if available).
 */
export async function searchUsers(client: MatrixClient, term: string, signal?: AbortSignal): Promise<UserSearchResult[]> {
  const query = term.trim()
  if (!query) return []
  const ownId = client.getUserId()

  const results: UserSearchResult[] = []
  try {
    const response = await client.searchUserDirectory({ term: query, limit: 10 })
    response.results.forEach((user) => {
      results.push({ userId: user.user_id, displayName: user.display_name || user.user_id, avatarMxc: user.avatar_url })
    })
  } catch (error) {
    console.warn('User directory search failed:', error)
  }
  if (signal?.aborted) return []

  if (isFullUserId(query) && !results.some((user) => user.userId === query)) {
    try {
      const profile = await client.getProfileInfo(query)
      results.unshift({ userId: query, displayName: profile.displayname || query, avatarMxc: profile.avatar_url })
    } catch {
      // Unknown profile (or private): still let the user try to invite the ID.
      results.unshift({ userId: query, displayName: query })
    }
  }
  return results.filter((user) => user.userId !== ownId)
}

/**
 * Invite someone to a space ("server"). They join its open channels when accepting; private
 * (invite-only) channels stay private and need their own invite, see inviteToChannel.
 */
export async function inviteToSpace(client: MatrixClient, spaceId: string, userId: string): Promise<void> {
  await client.invite(spaceId, userId)
}

/** Add someone to a single channel, and to its server if they aren't a member yet. */
export async function inviteToChannel(client: MatrixClient, serverId: string, roomId: string, userId: string): Promise<void> {
  const serverMembership = client.getRoom(serverId)?.getMember(userId)?.membership
  if (serverMembership !== 'join' && serverMembership !== 'invite') await client.invite(serverId, userId)
  await client.invite(roomId, userId)
}

/**
 * Join the channels and categories (sub-spaces) of a space, like Discord shows all channels
 * of a server. Uses the hierarchy API because our copy of the space state may not have synced
 * yet. Returns the number of rooms joined; rooms we may not join are skipped.
 * `background`: for syncing without a user action. Doesn't rejoin rooms we left or were removed
 * from and leaves pending invites alone: a private channel needs its invite accepted explicitly.
 */
export async function joinSpaceChannels(
  client: MatrixClient,
  spaceId: string,
  options: { background?: boolean } = {},
): Promise<number> {
  let joined = 0
  let from: string | undefined
  const viaById = new Map<string, string[]>()
  const candidates: Array<{ roomId: string; joinRule?: string }> = []

  do {
    const page = await client.getRoomHierarchy(spaceId, 50, undefined, false, from)
    page.rooms.forEach((entry) => {
      entry.children_state.forEach((child) => {
        const via = (child.content as { via?: unknown }).via
        if (Array.isArray(via)) viaById.set(child.state_key, via.filter((server): server is string => typeof server === 'string'))
      })
      if (entry.room_id === spaceId) return
      candidates.push({ roomId: entry.room_id, joinRule: (entry as { join_rule?: string }).join_rule })
    })
    from = page.next_batch
  } while (from)

  for (const { roomId, joinRule } of candidates) {
    const membership = client.getRoom(roomId)?.getMyMembership()
    if (membership === 'join' || membership === 'ban') continue
    if (options.background && (membership === 'leave' || membership === 'invite')) continue
    // Invite-only channels nobody invited us to would just fail.
    if ((joinRule === JoinRule.Invite || joinRule === JoinRule.Knock) && membership !== 'invite') continue
    try {
      await client.joinRoom(roomId, { viaServers: viaById.get(roomId) })
      joined += 1
    } catch (error) {
      console.info(`Could not join channel ${roomId}:`, error)
    }
  }
  return joined
}
