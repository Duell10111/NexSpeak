/**
 * Discord-style server management mapped onto Matrix, the way Element models it:
 * server = space, category = sub-space, channel = room, position = m.space.child "order",
 * private channel = invite-only room, roles = power levels, icon = m.room.avatar.
 */

import { EventType, Preset, Visibility, type ICreateRoomOpts, type MatrixClient, type Room } from 'matrix-js-sdk'
import { shouldUseHydraForRoomVersion } from 'matrix-js-sdk/lib/utils/roomVersion.js'
import { CALL_MEMBER_EVENT_TYPE } from './rtc'
import { planMove, sortSpaceChildren, isValidOrder, type SpaceChildLink } from './space-order'

const SPACE_CHILD = 'm.space.child'
const SPACE_PARENT = 'm.space.parent'
const MAX_ICON_BYTES = 10 * 1024 * 1024

export const ROLE_LEVELS = { admin: 100, moderator: 50, member: 0 } as const
export type ServerRole = keyof typeof ROLE_LEVELS

// Synapse replaces its entire default `events` map when an override is supplied.
const ADMIN_ONLY_EVENTS = [
  EventType.RoomPowerLevels,
  EventType.RoomHistoryVisibility,
  EventType.RoomEncryption,
  EventType.RoomTombstone,
  EventType.RoomServerAcl,
] as const

function defaultPowerLevels() {
  return {
    users_default: ROLE_LEVELS.member,
    events_default: ROLE_LEVELS.member,
    state_default: ROLE_LEVELS.moderator,
    ban: ROLE_LEVELS.moderator,
    kick: ROLE_LEVELS.moderator,
    redact: ROLE_LEVELS.moderator,
    invite: ROLE_LEVELS.member,
    events: {
      ...Object.fromEntries(ADMIN_ONLY_EVENTS.map((type) => [type, ROLE_LEVELS.admin])),
      [CALL_MEMBER_EVENT_TYPE]: ROLE_LEVELS.member,
    },
  }
}

export function roleForLevel(level: number): ServerRole {
  return level >= ROLE_LEVELS.admin ? 'admin' : level >= ROLE_LEVELS.moderator ? 'moderator' : 'member'
}

// sendStateEvent is typed per known event type; space and power level contents are plain objects here.
type LooseStateSender = (roomId: string, type: string, content: Record<string, unknown>, stateKey: string) => Promise<unknown>

function sendState(client: MatrixClient, roomId: string, type: string, content: Record<string, unknown>, stateKey = '') {
  return (client.sendStateEvent as unknown as LooseStateSender).call(client, roomId, type, content, stateKey)
}

function ownServerName(client: MatrixClient): string {
  return client.getDomain() ?? client.getUserId()?.split(':').slice(1).join(':') ?? ''
}

export function getChildLinks(space: Room | null | undefined): SpaceChildLink[] {
  if (!space) return []
  return space.currentState
    .getStateEvents(SPACE_CHILD)
    .map((event): SpaceChildLink | null => {
      const content = event.getContent()
      const via = Array.isArray(content.via) ? content.via.filter((server): server is string => typeof server === 'string') : null
      const roomId = event.getStateKey()
      if (!via || !roomId) return null
      const link: SpaceChildLink = { roomId, via, ts: event.getTs() }
      if (isValidOrder(content.order)) link.order = content.order
      return link
    })
    .filter((link): link is SpaceChildLink => link !== null)
}

/** Child room IDs of a space in display order. */
export function getOrderedChildIds(space: Room | null | undefined): string[] {
  return sortSpaceChildren(getChildLinks(space)).map((link) => link.roomId)
}

function powerLevels(room: Room | null | undefined): Record<string, unknown> {
  return (room?.currentState.getStateEvents(EventType.RoomPowerLevels, '')?.getContent() ?? {}) as Record<string, unknown>
}

function may(client: MatrixClient, room: Room | null | undefined, eventType: string): boolean {
  const userId = client.getUserId()
  return Boolean(room && userId && room.currentState.maySendStateEvent(eventType, userId))
}

/** Create, move and delete channels and categories. */
export function canManageChannels(client: MatrixClient, serverId: string): boolean {
  return may(client, client.getRoom(serverId), SPACE_CHILD)
}

export function canEditRoom(client: MatrixClient, roomId: string): boolean {
  return may(client, client.getRoom(roomId), EventType.RoomName)
}

export function canManageRoles(client: MatrixClient, roomId: string): boolean {
  return may(client, client.getRoom(roomId), EventType.RoomPowerLevels)
}

/** Old rooms can allow moderators to edit power levels; repairs still require an admin. */
export function canRepairServerPermissions(client: MatrixClient, serverId: string): boolean {
  const userId = client.getUserId()
  const level = userId ? client.getRoom(serverId)?.getMember(userId)?.powerLevel : undefined
  return level !== undefined && level >= ROLE_LEVELS.admin && canManageRoles(client, serverId)
}

/** Categories (sub-spaces) and channels of a server, at any depth. */
export function getServerRoomIds(client: MatrixClient, serverId: string): { categories: string[]; channels: string[] } {
  const categories: string[] = []
  const channels: string[] = []
  const visited = new Set<string>([serverId])
  const walk = (spaceId: string) => {
    getOrderedChildIds(client.getRoom(spaceId)).forEach((roomId) => {
      if (visited.has(roomId)) return
      visited.add(roomId)
      const room = client.getRoom(roomId)
      if (room?.isSpaceRoom()) {
        categories.push(roomId)
        walk(roomId)
      } else {
        channels.push(roomId)
      }
    })
  }
  walk(serverId)
  return { categories, channels }
}

async function linkChild(client: MatrixClient, parentId: string, roomId: string, via: string[], order?: string) {
  await sendState(client, parentId, SPACE_CHILD, order ? { via, order } : { via }, roomId)
}

async function unlinkChild(client: MatrixClient, parentId: string, roomId: string) {
  await sendState(client, parentId, SPACE_CHILD, {}, roomId)
}

/**
 * Move a channel or category to a new position: before `beforeRoomId` in `toParentId`
 * (null: at the end). Moving between parents links first and unlinks afterwards, so the
 * channel never disappears in between.
 */
export async function moveChild(
  client: MatrixClient,
  options: { roomId: string; fromParentId: string; toParentId: string; beforeRoomId: string | null },
): Promise<void> {
  const { roomId, fromParentId, toParentId, beforeRoomId } = options
  if (roomId === beforeRoomId) return
  const target = client.getRoom(toParentId)
  const siblings = getChildLinks(target)
  const viaOf = (id: string) =>
    [...getChildLinks(client.getRoom(fromParentId)), ...siblings].find((link) => link.roomId === id)?.via ?? [ownServerName(client)]

  for (const update of planMove(siblings, roomId, beforeRoomId)) {
    await linkChild(client, toParentId, update.roomId, viaOf(update.roomId), update.order)
  }

  if (fromParentId !== toParentId) {
    await unlinkChild(client, fromParentId, roomId)
    // The canonical parent only matters to other clients; we may lack the permission.
    try {
      await sendState(client, roomId, SPACE_PARENT, { via: [ownServerName(client)], canonical: true }, toParentId)
      await sendState(client, roomId, SPACE_PARENT, {}, fromParentId)
    } catch (error) {
      console.info('Could not update the parent of the moved room:', error)
    }
  }
}

/** Room version and power levels for a new channel or category of a server. */
function inheritedRoomOptions(client: MatrixClient, serverId: string) {
  // Roles are server-wide on Discord: carry the server's admins and moderators over.
  const server = client.getRoom(serverId)
  const users = { ...(powerLevels(server).users ?? {}) } as Record<string, number>
  const version = server?.getVersion()
  if (server && version && shouldUseHydraForRoomVersion(version)) {
    // v12+ creators hold the top role implicitly and are not listed in `users`; list them so
    // the owner stays admin in channels created by other admins.
    const create = server.currentState.getStateEvents(EventType.RoomCreate, '')
    const additional = create?.getContent().additional_creators
    for (const creator of [create?.getSender(), ...(Array.isArray(additional) ? additional : [])]) {
      if (typeof creator === 'string') users[creator] = ROLE_LEVELS.admin
    }
    // The new room uses the same version, so we become its creator, and v12+ rejects listing creators.
    delete users[client.getUserId() ?? '']
  }
  return {
    room_version: version || undefined,
    power_level_content_override: { ...defaultPowerLevels(), users },
  }
}

/** Finish the initial state before restoring a pre-v12 creator's inherited role. */
async function createServerChild(client: MatrixClient, serverId: string, options: ICreateRoomOpts): Promise<string> {
  const userId = client.getUserId()
  if (!userId) throw new Error('Not logged in')
  const inherited = inheritedRoomOptions(client, serverId)
  const levels = inherited.power_level_content_override
  const creatorLevel = levels.users[userId] ?? levels.users_default
  const restoreRole = inherited.room_version && !shouldUseHydraForRoomVersion(inherited.room_version) && creatorLevel < ROLE_LEVELS.admin
  if (restoreRole) {
    // Synapse sends power levels before the preset/initial state, which needs admin rights.
    levels.users[userId] = ROLE_LEVELS.admin
  }
  const { room_id: roomId } = await client.createRoom({ ...options, ...inherited })
  if (restoreRole) {
    try {
      await client.setPowerLevel(roomId, userId, creatorLevel)
    } catch (error) {
      // Never publish a room with an unintentionally elevated creator role.
      await client.leave(roomId).catch((cleanupError: unknown) => console.warn('Could not leave incomplete server room:', cleanupError))
      throw error
    }
  }
  return roomId
}

function openToServer(serverId: string) {
  return { join_rule: 'restricted', allow: [{ type: 'm.room_membership', room_id: serverId }] }
}

/** Creates a private server and its first text/voice channel without waiting for sync. */
export async function createServer(
  client: MatrixClient,
  options: { name: string; topic?: string; icon?: File },
): Promise<{ serverId: string; channelId: string }> {
  const name = options.name.trim()
  const userId = client.getUserId()
  if (!name) throw new Error('Server name is required')
  if (!userId) throw new Error('Not logged in')

  // Upload before creating any rooms so an upload failure leaves no half-created server.
  const avatar = options.icon ? await uploadRoomIcon(client, options.icon) : undefined
  // Let the homeserver assign the creator's role: 100 in older rooms, implicit and
  // immutable in v12+. Listing the creator in `users` is rejected by v12+ rooms.
  const levels = defaultPowerLevels()
  const { room_id: serverId } = await client.createRoom({
    name,
    topic: options.topic?.trim() || undefined,
    preset: Preset.PrivateChat,
    visibility: Visibility.Private,
    creation_content: { type: 'm.space' },
    initial_state: avatar ? [{ type: EventType.RoomAvatar, state_key: '', content: avatar }] : [],
    power_level_content_override: levels,
  })

  let channelId: string | undefined
  try {
    const via = [ownServerName(client)]
    const result = await client.createRoom({
      name: 'general',
      preset: Preset.PrivateChat,
      visibility: Visibility.Private,
      initial_state: [
        { type: EventType.RoomJoinRules, state_key: '', content: openToServer(serverId) },
        { type: EventType.RoomHistoryVisibility, state_key: '', content: { history_visibility: 'shared' } },
        { type: SPACE_PARENT, state_key: serverId, content: { via, canonical: true } },
      ] as never,
      power_level_content_override: levels,
    })
    channelId = result.room_id
    await linkChild(client, serverId, channelId, via)
    return { serverId, channelId }
  } catch (error) {
    // Nobody else has been invited yet. Leave incomplete rooms so retries don't clutter the sidebar.
    for (const roomId of [channelId, serverId]) {
      if (!roomId) continue
      await client.leave(roomId).catch((cleanupError: unknown) => console.warn('Could not leave incomplete server room:', cleanupError))
    }
    throw error
  }
}

export async function createChannel(
  client: MatrixClient,
  options: { serverId: string; parentId: string; name: string; topic?: string; isPrivate: boolean; encrypted: boolean },
): Promise<string> {
  const { serverId, parentId, name, topic, isPrivate, encrypted } = options
  const via = [ownServerName(client)]
  const initialState: Array<{ type: string; state_key: string; content: Record<string, unknown> }> = [
    { type: EventType.RoomJoinRules, state_key: '', content: isPrivate ? { join_rule: 'invite' } : openToServer(serverId) },
    { type: EventType.RoomHistoryVisibility, state_key: '', content: { history_visibility: 'shared' } },
    { type: SPACE_PARENT, state_key: parentId, content: { via, canonical: true } },
  ]
  if (encrypted) {
    initialState.push({ type: EventType.RoomEncryption, state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } })
  }

  const roomId = await createServerChild(client, serverId, {
    name,
    topic: topic || undefined,
    preset: Preset.PrivateChat,
    visibility: Visibility.Private,
    initial_state: initialState as never,
  })
  const [placement] = planMove(getChildLinks(client.getRoom(parentId)), roomId, null)
  await linkChild(client, parentId, roomId, via, placement?.order)
  return roomId
}

export async function createCategory(client: MatrixClient, options: { serverId: string; name: string }): Promise<string> {
  const { serverId, name } = options
  const via = [ownServerName(client)]
  const roomId = await createServerChild(client, serverId, {
    name,
    preset: Preset.PrivateChat,
    visibility: Visibility.Private,
    creation_content: { type: 'm.space' },
    initial_state: [
      { type: EventType.RoomJoinRules, state_key: '', content: openToServer(serverId) },
      { type: SPACE_PARENT, state_key: serverId, content: { via, canonical: true } },
    ] as never,
  })
  const [placement] = planMove(getChildLinks(client.getRoom(serverId)), roomId, null)
  await linkChild(client, serverId, roomId, via, placement?.order)
  return roomId
}

async function uploadRoomIcon(client: MatrixClient, file: File) {
  if (file.size > MAX_ICON_BYTES) throw new RangeError('icon too large')
  const { content_uri: url } = await client.uploadContent(file, { name: file.name, type: file.type })
  return { url, info: { mimetype: file.type, size: file.size } }
}

export async function setRoomIcon(client: MatrixClient, roomId: string, file: File | null): Promise<void> {
  if (!file) {
    await sendState(client, roomId, EventType.RoomAvatar, {})
    return
  }
  await sendState(client, roomId, EventType.RoomAvatar, await uploadRoomIcon(client, file))
}

export interface RoomDetails {
  name: string
  topic: string
  iconMxc?: string
}

export function readRoomDetails(room: Room | null | undefined): RoomDetails {
  const topic = room?.currentState.getStateEvents(EventType.RoomTopic, '')?.getContent().topic
  return { name: room?.name ?? '', topic: typeof topic === 'string' ? topic : '', iconMxc: room?.getMxcAvatarUrl() || undefined }
}

/** Saves name and topic; only sends what changed. */
export async function saveRoomDetails(client: MatrixClient, roomId: string, next: { name: string; topic: string }): Promise<void> {
  const current = readRoomDetails(client.getRoom(roomId))
  if (next.name.trim() && next.name.trim() !== current.name) await client.setRoomName(roomId, next.name.trim())
  if (next.topic.trim() !== current.topic) await client.setRoomTopic(roomId, next.topic.trim())
}

export interface ChannelPermissions {
  isPrivate: boolean
  moderatorsOnlyWrite: boolean
  everyoneCanCall: boolean
}

export function readChannelPermissions(room: Room | null | undefined): ChannelPermissions {
  const levels = powerLevels(room)
  const events = (levels.events ?? {}) as Record<string, number>
  const usersDefault = (levels.users_default as number | undefined) ?? 0
  const eventsDefault = (levels.events_default as number | undefined) ?? 0
  const messageLevel = events[EventType.RoomMessage] ?? eventsDefault
  const callLevel = events[CALL_MEMBER_EVENT_TYPE] ?? (levels.state_default as number | undefined) ?? 50
  return {
    isPrivate: room?.getJoinRule() === 'invite',
    moderatorsOnlyWrite: messageLevel > usersDefault,
    everyoneCanCall: callLevel <= usersDefault,
  }
}

export async function saveChannelPermissions(
  client: MatrixClient,
  options: { roomId: string; serverId: string; permissions: ChannelPermissions },
): Promise<void> {
  const { roomId, serverId, permissions } = options
  const room = client.getRoom(roomId)
  const current = readChannelPermissions(room)

  if (permissions.isPrivate !== current.isPrivate) {
    await sendState(client, roomId, EventType.RoomJoinRules, permissions.isPrivate ? { join_rule: 'invite' } : openToServer(serverId))
  }
  if (permissions.moderatorsOnlyWrite !== current.moderatorsOnlyWrite || permissions.everyoneCanCall !== current.everyoneCanCall) {
    const levels = powerLevels(room)
    const events = { ...((levels.events ?? {}) as Record<string, number>) }
    const writeLevel = permissions.moderatorsOnlyWrite ? ROLE_LEVELS.moderator : ROLE_LEVELS.member
    const callLevel = permissions.everyoneCanCall ? ROLE_LEVELS.member : ROLE_LEVELS.moderator
    // Messages, reactions and attachments all count as writing.
    events[EventType.RoomMessage] = writeLevel
    events[EventType.Reaction] = writeLevel
    events[CALL_MEMBER_EVENT_TYPE] = callLevel
    await sendState(client, roomId, EventType.RoomPowerLevels, { ...levels, events_default: writeLevel, events })
  }
}

/** Runs an action on many rooms; rooms where it fails (no permission, not a member) are skipped. */
async function forEachRoom(roomIds: string[], action: (roomId: string) => Promise<unknown>): Promise<number> {
  let failed = 0
  for (const roomId of roomIds) {
    try {
      await action(roomId)
    } catch (error) {
      failed += 1
      console.info(`Skipped ${roomId}:`, error)
    }
  }
  return failed
}

/** Everything belonging to a server, the server itself last. */
function allServerRooms(client: MatrixClient, serverId: string): string[] {
  const { categories, channels } = getServerRoomIds(client, serverId)
  return [...channels, ...categories, serverId]
}

type PermissionRepairResult = { repaired: number; failed: number }
const permissionRepairs = new WeakMap<MatrixClient, Map<string, Promise<PermissionRepairResult>>>()

/**
 * Explicit repair only: restore admin-only state events without resetting roles or channel
 * permissions. Share a pending run even if its settings dialog is unmounted and opened again.
 */
export function repairServerPermissions(client: MatrixClient, serverId: string): Promise<PermissionRepairResult> {
  let repairs = permissionRepairs.get(client)
  const existing = repairs?.get(serverId)
  if (existing) return existing
  if (!repairs) {
    repairs = new Map()
    permissionRepairs.set(client, repairs)
  }
  const pending = runPermissionRepair(client, serverId).finally(() => {
    repairs.delete(serverId)
    if (!repairs.size) permissionRepairs.delete(client)
  })
  repairs.set(serverId, pending)
  return pending
}

async function runPermissionRepair(
  client: MatrixClient,
  serverId: string,
): Promise<PermissionRepairResult> {
  if (!canRepairServerPermissions(client, serverId)) throw new Error('Only server admins can repair permissions')
  let repaired = 0
  // Read fresh state and keep stricter limits. Sequential writes avoid flooding homeservers;
  // failures do not stop the remaining rooms, and unchanged rooms need no write.
  const failed = await forEachRoom(allServerRooms(client, serverId), async (roomId) => {
    const levels = await client.getStateEvent(roomId, EventType.RoomPowerLevels, '')
    const events = { ...levels.events }
    let changed = false
    for (const type of ADMIN_ONLY_EVENTS) {
      if ((events[type] ?? levels.state_default ?? ROLE_LEVELS.moderator) < ROLE_LEVELS.admin) {
        events[type] = ROLE_LEVELS.admin
        changed = true
      }
    }
    if (!changed) return
    await sendState(client, roomId, EventType.RoomPowerLevels, { ...levels, events })
    repaired += 1
  })
  return { repaired, failed }
}

/** Discord roles map to power levels; applied in every room of the server we may change. */
export async function setServerRole(client: MatrixClient, serverId: string, userId: string, role: ServerRole): Promise<void> {
  const level = ROLE_LEVELS[role]
  // The server itself first: if that fails, the user isn't allowed to hand out this role.
  await client.setPowerLevel(serverId, userId, level)
  const rooms = allServerRooms(client, serverId).filter((roomId) => roomId !== serverId && client.getRoom(roomId)?.getMember(userId))
  await forEachRoom(rooms, (roomId) => client.setPowerLevel(roomId, userId, level))
}

function roomsWithMember(client: MatrixClient, roomIds: string[], userId: string): string[] {
  return roomIds.filter((roomId) => {
    const membership = client.getRoom(roomId)?.getMember(userId)?.membership
    return membership === 'join' || membership === 'invite'
  })
}

export async function kickFromServer(client: MatrixClient, serverId: string, userId: string, reason?: string): Promise<void> {
  const rooms = allServerRooms(client, serverId)
  await forEachRoom(roomsWithMember(client, rooms.slice(0, -1), userId), (roomId) => client.kick(roomId, userId, reason))
  await client.kick(serverId, userId, reason)
}

export async function banFromServer(client: MatrixClient, serverId: string, userId: string, reason?: string): Promise<void> {
  // Bans also keep the user out of the open channels, which only check server membership.
  const rooms = allServerRooms(client, serverId)
  await forEachRoom(rooms.slice(0, -1), (roomId) => client.ban(roomId, userId, reason))
  await client.ban(serverId, userId, reason)
}

export async function leaveServer(client: MatrixClient, serverId: string): Promise<void> {
  const rooms = allServerRooms(client, serverId)
  await forEachRoom(rooms.slice(0, -1), (roomId) => client.leave(roomId))
  await client.leave(serverId)
}

/**
 * Matrix rooms can't be deleted. Like deleting on Discord, the channel is removed from the
 * server for everyone: unlinked, everybody else removed, and left. Messages stay on the
 * homeservers of the participants.
 */
export async function deleteChannel(client: MatrixClient, options: { parentId: string; roomId: string; reason: string }): Promise<void> {
  const { parentId, roomId, reason } = options
  await unlinkChild(client, parentId, roomId)
  const room = client.getRoom(roomId)
  const ownId = client.getUserId()
  const others = (room?.getMembers() ?? [])
    .filter((member) => member.userId !== ownId && (member.membership === 'join' || member.membership === 'invite'))
    .map((member) => member.userId)
  await forEachRoom([roomId], () => sendState(client, roomId, EventType.RoomJoinRules, { join_rule: 'invite' }))
  for (const userId of others) {
    await forEachRoom([roomId], () => client.kick(roomId, userId, reason))
  }
  await client.leave(roomId)
}

/** Discord keeps the channels of a deleted category: they move to the top level of the server. */
export async function deleteCategory(
  client: MatrixClient,
  options: { serverId: string; categoryId: string; reason: string },
): Promise<void> {
  const { serverId, categoryId, reason } = options
  for (const roomId of getOrderedChildIds(client.getRoom(categoryId))) {
    await moveChild(client, { roomId, fromParentId: categoryId, toParentId: serverId, beforeRoomId: null })
  }
  await deleteChannel(client, { parentId: serverId, roomId: categoryId, reason })
}

/** The space that links this room: the server itself or one of its categories. */
export function findParentId(client: MatrixClient, serverId: string, roomId: string): string | null {
  const candidates = [serverId, ...getServerRoomIds(client, serverId).categories]
  return candidates.find((spaceId) => getChildLinks(client.getRoom(spaceId)).some((link) => link.roomId === roomId)) ?? null
}
