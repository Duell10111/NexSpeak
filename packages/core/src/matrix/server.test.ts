import { describe, expect, it, vi } from 'vitest'
import type { MatrixClient } from 'matrix-js-sdk'
import {
  canRepairServerPermissions,
  createCategory,
  createChannel,
  createServer,
  moveChild,
  readPermissionParent,
  readRoomPermissions,
  readMemberRoleIds,
  repairServerPermissions,
  savePermissions,
  saveServerRoles,
  setMemberRoles,
  syncPermissionsWithParent,
} from './server'
import { MEMBER_ROLES_EVENT, readRoles, ROLES_EVENT } from './roles'
import { readPermissionLevels } from './permissions'
import { CALL_MEMBER_EVENT_TYPE } from './rtc'

const USER = '@alice:example.org'
const SERVER = '!server:example.org'
const CHANNEL = '!general:example.org'
const ADMIN_EVENTS = {
  'm.room.power_levels': 100,
  'm.room.history_visibility': 100,
  'm.room.encryption': 100,
  'm.room.tombstone': 100,
  'm.room.server_acl': 100,
}
const DEFAULT_LEVELS = {
  users_default: 0, events_default: 0, state_default: 50,
  ban: 50, kick: 50, redact: 50, invite: 0,
  events: { ...ADMIN_EVENTS, [CALL_MEMBER_EVENT_TYPE]: 0 },
}

function setup() {
  const fake = {
    getUserId: vi.fn(() => USER as string | null),
    getDomain: vi.fn(() => 'example.org'),
    // No room has synced yet; creation must not read state to inherit the creator's role.
    getRoom: vi.fn(() => null),
    createRoom: vi.fn().mockResolvedValueOnce({ room_id: SERVER }).mockResolvedValueOnce({ room_id: CHANNEL }),
    uploadContent: vi.fn().mockResolvedValue({ content_uri: 'mxc://example.org/icon' }),
    sendStateEvent: vi.fn().mockResolvedValue({}),
    setPowerLevel: vi.fn().mockResolvedValue({}),
    leave: vi.fn().mockResolvedValue({}),
  }
  return { fake, client: fake as unknown as MatrixClient }
}

describe('createServer', () => {
  it('creates a private space with a restricted text/voice channel using only one additional state event', async () => {
    const { fake, client } = setup()
    await expect(createServer(client, { name: '  Friends  ', topic: '  Games  ' })).resolves.toEqual({
      serverId: SERVER, channelId: CHANNEL,
    })
    expect(fake.createRoom).toHaveBeenCalledTimes(2)
    expect(fake.createRoom).toHaveBeenNthCalledWith(1, expect.objectContaining({
      name: 'Friends', topic: 'Games', preset: 'private_chat', visibility: 'private',
      creation_content: { type: 'm.space' }, initial_state: [],
    }))
    expect(fake.createRoom).toHaveBeenNthCalledWith(2, expect.objectContaining({
      name: 'general', preset: 'private_chat', visibility: 'private',
      initial_state: [
        { type: 'm.room.join_rules', state_key: '', content: { join_rule: 'restricted', allow: [{ type: 'm.room_membership', room_id: SERVER }] } },
        { type: 'm.room.history_visibility', state_key: '', content: { history_visibility: 'shared' } },
        { type: 'm.space.parent', state_key: SERVER, content: { via: ['example.org'], canonical: true } },
      ],
    }))
    for (const [request] of fake.createRoom.mock.calls) {
      expect(request.power_level_content_override).toMatchObject({
        users_default: 0, events_default: 0, state_default: 50,
        ban: 50, kick: 50, redact: 50,
        events: {
          ...ADMIN_EVENTS, [CALL_MEMBER_EVENT_TYPE]: 0,
        },
      })
      expect(request.power_level_content_override).not.toHaveProperty('users')
    }
    expect(fake.sendStateEvent).toHaveBeenCalledExactlyOnceWith(SERVER, 'm.space.child', { via: ['example.org'] }, CHANNEL)
    expect(fake.getRoom).not.toHaveBeenCalled()
    expect(fake.uploadContent).not.toHaveBeenCalled()
    expect(fake.leave).not.toHaveBeenCalled()
  })

  it('uploads the optional icon first and bundles it in the initial space state', async () => {
    const { fake, client } = setup()
    const icon = new File(['image'], 'icon.png', { type: 'image/png' })
    await createServer(client, { name: 'Friends', icon })
    expect(fake.uploadContent).toHaveBeenCalledExactlyOnceWith(icon, { name: 'icon.png', type: 'image/png' })
    expect(fake.uploadContent.mock.invocationCallOrder[0]).toBeLessThan(fake.createRoom.mock.invocationCallOrder[0])
    expect(fake.createRoom).toHaveBeenNthCalledWith(1, expect.objectContaining({
      topic: undefined,
      initial_state: [{ type: 'm.room.avatar', state_key: '', content: {
        url: 'mxc://example.org/icon', info: { mimetype: 'image/png', size: icon.size },
      } }],
    }))
    expect(fake.sendStateEvent).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid names and missing sessions before uploading or creating rooms', async () => {
    const { fake, client } = setup()
    await expect(createServer(client, { name: '   ' })).rejects.toThrow('Server name is required')
    fake.getUserId.mockReturnValue(null)
    await expect(createServer(client, { name: 'Friends' })).rejects.toThrow('Not logged in')
    expect(fake.createRoom).not.toHaveBeenCalled()
    expect(fake.uploadContent).not.toHaveBeenCalled()
  })

  it('rejects oversized icons before uploading or creating rooms', async () => {
    const { fake, client } = setup()
    const icon = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })
    await expect(createServer(client, { name: 'Friends', icon })).rejects.toThrow(RangeError)
    expect(fake.uploadContent).not.toHaveBeenCalled()
    expect(fake.createRoom).not.toHaveBeenCalled()
  })

  it('does not create rooms if the upload fails', async () => {
    const { fake, client } = setup()
    const error = new Error('Upload failed')
    fake.uploadContent.mockRejectedValue(error)
    await expect(createServer(client, { name: 'Friends', icon: new File(['x'], 'icon.png') })).rejects.toBe(error)
    expect(fake.createRoom).not.toHaveBeenCalled()
    expect(fake.leave).not.toHaveBeenCalled()
  })

  it('leaves the incomplete space if channel creation fails', async () => {
    const { fake, client } = setup()
    const error = new Error('Rate limited')
    fake.createRoom.mockReset().mockResolvedValueOnce({ room_id: SERVER }).mockRejectedValueOnce(error)
    await expect(createServer(client, { name: 'Friends' })).rejects.toBe(error)
    expect(fake.leave).toHaveBeenCalledExactlyOnceWith(SERVER)
    expect(fake.sendStateEvent).not.toHaveBeenCalled()
  })

  it('leaves both incomplete rooms if linking fails, preserving the original error even if cleanup fails', async () => {
    const { fake, client } = setup()
    const error = new Error('Link failed')
    fake.sendStateEvent.mockRejectedValue(error)
    fake.leave.mockRejectedValueOnce(new Error('Cleanup failed'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(createServer(client, { name: 'Friends' })).rejects.toBe(error)
      expect(fake.leave).toHaveBeenCalledTimes(2)
      expect(fake.leave).toHaveBeenNthCalledWith(1, CHANNEL)
      expect(fake.leave).toHaveBeenNthCalledWith(2, SERVER)
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })
})

describe.each(['channel', 'category'] as const)('create %s', (kind) => {
  const OWNER = '@owner:example.org'

  function setupServer(version: string, users: Record<string, number>) {
    const { fake, client } = setup()
    const create = { getSender: () => OWNER, getContent: () => ({ additional_creators: ['@co:example.org'] }) }
    const levels = { getContent: () => ({ ...DEFAULT_LEVELS, users }) }
    const server = {
      getVersion: () => version,
      isSpaceRoom: () => true,
      currentState: {
        getStateEvents: (type: string) =>
          type === 'm.room.create' ? create : type === 'm.room.power_levels' ? levels : [],
      },
    }
    fake.getRoom.mockImplementation((() => server) as never)
    fake.createRoom.mockReset().mockResolvedValue({ room_id: CHANNEL })
    return { fake, client }
  }

  const create = (client: MatrixClient, encrypted = false) =>
    kind === 'channel'
      ? createChannel(client, { serverId: SERVER, parentId: SERVER, name: 'news', isPrivate: false, encrypted })
      : createCategory(client, { serverId: SERVER, name: 'news' })

  it('includes all admin-only events when replacing the homeserver defaults', async () => {
    const { fake, client } = setupServer('11', { [USER]: 100, '@mod:example.org': 50 })
    await create(client)
    const [request] = fake.createRoom.mock.calls[0]
    expect(request.power_level_content_override).toEqual({
      users: { [USER]: 100, '@mod:example.org': 50 },
      users_default: 0, events_default: 0, state_default: 50,
      ban: 50, kick: 50, redact: 50, invite: 0,
      events: { ...ADMIN_EVENTS, [CALL_MEMBER_EVENT_TYPE]: 0 },
    })
    expect(fake.setPowerLevel).not.toHaveBeenCalled()
  })

  it('keeps v12+ creators admin and never lists the new room creator', async () => {
    const { fake, client } = setupServer('12', { [USER]: 100, '@mod:example.org': 50 })
    await create(client)
    const [request] = fake.createRoom.mock.calls[0]
    expect(request.room_version).toBe('12')
    expect(request.power_level_content_override.users).toEqual({
      [OWNER]: 100, '@co:example.org': 100, '@mod:example.org': 50,
    })
    expect(fake.setPowerLevel).not.toHaveBeenCalled()
  })

  it('copies the roles of pre-v12 servers unchanged', async () => {
    const { fake, client } = setupServer('11', { [USER]: 100, [OWNER]: 50 })
    await create(client)
    const [request] = fake.createRoom.mock.calls[0]
    expect(request.room_version).toBe('11')
    expect(request.power_level_content_override.users).toEqual({ [USER]: 100, [OWNER]: 50 })
    expect(fake.setPowerLevel).not.toHaveBeenCalled()
  })

  it('initializes privileged state before restoring a pre-v12 moderator and linking the room', async () => {
    const users = { [USER]: 50, [OWNER]: 100 }
    const { fake, client } = setupServer('11', users)
    let finish!: (value: object) => void
    fake.setPowerLevel.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const pending = create(client, true)
    await vi.waitFor(() => expect(fake.setPowerLevel).toHaveBeenCalledExactlyOnceWith(CHANNEL, USER, 50))
    const [request] = fake.createRoom.mock.calls[0]
    expect(request.power_level_content_override.users).toEqual({ [USER]: 100, [OWNER]: 100 })
    expect(request.power_level_content_override.events).toMatchObject(ADMIN_EVENTS)
    if (kind === 'channel') {
      expect(request.initial_state).toContainEqual({ type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } })
    }
    expect(fake.sendStateEvent).not.toHaveBeenCalled()
    finish({})
    await expect(pending).resolves.toBe(CHANNEL)
    expect(fake.sendStateEvent).toHaveBeenCalledTimes(1)
    expect(users).toEqual({ [USER]: 50, [OWNER]: 100 })
  })

  it.each([false, true])('does not link an elevated room if restoring the role fails (cleanup fails: %s)', async (cleanupFails) => {
    const { fake, client } = setupServer('11', { [USER]: 50, [OWNER]: 100 })
    const error = new Error('Role restoration failed')
    fake.setPowerLevel.mockRejectedValue(error)
    if (cleanupFails) fake.leave.mockRejectedValue(new Error('Leave failed'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(create(client)).rejects.toBe(error)
      expect(fake.leave).toHaveBeenCalledExactlyOnceWith(CHANNEL)
      expect(fake.sendStateEvent).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

describe('repairServerPermissions', () => {
  const CATEGORY = '!category:example.org'
  const NESTED = '!nested:example.org'
  type Levels = { events?: Record<string, number>; state_default?: number; [key: string]: unknown }

  function setupRepair(level = 100, maySend = true) {
    const levels: Record<string, Levels> = {
      [SERVER]: { events: { ...ADMIN_EVENTS, [CALL_MEMBER_EVENT_TYPE]: 0 } },
      [CHANNEL]: {
        users: { [USER]: 100, '@mod:example.org': 50 }, users_default: 0,
        events_default: 50, state_default: 50, invite: 50, notifications: { room: 50 },
        events: { [CALL_MEMBER_EVENT_TYPE]: 50, 'm.room.message': 50, 'custom.event': 75 },
      },
      [CATEGORY]: { events: { [CALL_MEMBER_EVENT_TYPE]: 0 } },
      [NESTED]: { state_default: 50 },
    }
    const rooms = Object.fromEntries(Object.keys(levels).map((id) => [id, {
      isSpaceRoom: () => id === SERVER || id === CATEGORY,
      getMember: vi.fn(() => ({ powerLevel: level })),
      currentState: {
        maySendStateEvent: vi.fn(() => maySend),
        getStateEvents: (type: string) => {
          if (type !== 'm.space.child') return null
          // Include duplicate links and a cycle: each room must be visited only once.
          const children = id === SERVER ? [CATEGORY, CHANNEL] : id === CATEGORY ? [NESTED, CHANNEL, SERVER] : []
          return children.map((child) => ({
            getContent: () => ({ via: ['example.org'] }), getStateKey: () => child, getTs: () => 0,
          }))
        },
      },
    }]))
    const fake = {
      getUserId: vi.fn(() => USER as string | null),
      getRoom: vi.fn((id: string) => rooms[id] ?? null),
      getStateEvent: vi.fn(async (id: string) => structuredClone(levels[id])),
      sendStateEvent: vi.fn(async (id: string, _type: string, content: Levels) => { levels[id] = content }),
    }
    return { fake, client: fake as unknown as MatrixClient, levels }
  }

  it('repairs nested rooms once, preserving fresh roles, custom events and channel permissions', async () => {
    const { fake, client, levels } = setupRepair()
    const original = structuredClone(levels[CHANNEL])
    await expect(repairServerPermissions(client, SERVER)).resolves.toEqual({ repaired: 3, failed: 0 })
    expect(fake.getStateEvent).toHaveBeenCalledTimes(4)
    expect(fake.sendStateEvent).toHaveBeenCalledTimes(3)
    expect(levels[CHANNEL]).toEqual({ ...original, events: { ...original.events, ...ADMIN_EVENTS } })
    expect(levels[CATEGORY].events).toEqual({ ...ADMIN_EVENTS, [CALL_MEMBER_EVENT_TYPE]: 0 })
    expect(levels[NESTED]).toEqual({ state_default: 50, events: ADMIN_EVENTS })
    expect(fake.sendStateEvent.mock.calls.some(([id]) => id === SERVER)).toBe(false)

    fake.sendStateEvent.mockClear()
    await expect(repairServerPermissions(client, SERVER)).resolves.toEqual({ repaired: 0, failed: 0 })
    expect(fake.sendStateEvent).not.toHaveBeenCalled()
  })

  it('keeps stricter explicit and inherited restrictions instead of resetting the template', async () => {
    const { client, levels } = setupRepair()
    levels[CHANNEL] = {
      state_default: 150,
      events: { 'm.room.power_levels': 150, 'm.room.encryption': 50, [CALL_MEMBER_EVENT_TYPE]: 50 },
    }
    levels[CATEGORY] = { state_default: 100 }
    await expect(repairServerPermissions(client, SERVER)).resolves.toEqual({ repaired: 2, failed: 0 })
    expect(levels[CHANNEL]).toEqual({
      state_default: 150,
      events: { 'm.room.power_levels': 150, 'm.room.encryption': 100, [CALL_MEMBER_EVENT_TYPE]: 50 },
    })
    expect(levels[CATEGORY]).toEqual({ state_default: 100 })
  })

  it('shares a pending repair for the same client and server, then allows a fresh run', async () => {
    const { fake, client } = setupRepair()
    const read = fake.getStateEvent.getMockImplementation()!
    let finish!: () => void
    const gate = new Promise<void>((resolve) => { finish = resolve })
    fake.getStateEvent.mockImplementationOnce(async (id) => {
      await gate
      return read(id)
    })
    const first = repairServerPermissions(client, SERVER)
    const second = repairServerPermissions(client, SERVER)
    expect(second).toBe(first)
    expect(fake.getStateEvent).toHaveBeenCalledTimes(1)
    finish()
    await expect(first).resolves.toEqual({ repaired: 3, failed: 0 })
    expect(fake.sendStateEvent).toHaveBeenCalledTimes(3)
    expect(fake.getStateEvent).toHaveBeenCalledTimes(4)
    const next = repairServerPermissions(client, SERVER)
    expect(next).not.toBe(first)
    await expect(next).resolves.toEqual({ repaired: 0, failed: 0 })
    expect(fake.getStateEvent).toHaveBeenCalledTimes(8)
    expect(fake.sendStateEvent).toHaveBeenCalledTimes(3)
  })

  it('reports read and write failures, continues with other rooms and supports retry', async () => {
    const { fake, client } = setupRepair()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    fake.getStateEvent.mockRejectedValueOnce(new Error('Not joined'))
    fake.sendStateEvent.mockRejectedValueOnce(new Error('Forbidden'))
    try {
      await expect(repairServerPermissions(client, SERVER)).resolves.toEqual({ repaired: 1, failed: 2 })
      expect(fake.getStateEvent).toHaveBeenCalledTimes(4)
      await expect(repairServerPermissions(client, SERVER)).resolves.toEqual({ repaired: 2, failed: 0 })
    } finally {
      info.mockRestore()
    }
  })

  it.each([[0, true], [50, true], [100, false]] as const)('rejects insufficient permissions (level %s, maySend %s)', async (level, maySend) => {
    const { fake, client } = setupRepair(level, maySend)
    expect(canRepairServerPermissions(client, SERVER)).toBe(false)
    await expect(repairServerPermissions(client, SERVER)).rejects.toThrow('Only server admins')
    expect(fake.getStateEvent).not.toHaveBeenCalled()
    expect(fake.sendStateEvent).not.toHaveBeenCalled()
  })

  it('requires a session and recognizes implicit v12 creator power levels', () => {
    const { fake, client } = setupRepair(Infinity)
    expect(canRepairServerPermissions(client, SERVER)).toBe(true)
    fake.getUserId.mockReturnValue(null)
    expect(canRepairServerPermissions(client, SERVER)).toBe(false)
  })
})

describe('category and channel permissions', () => {
  const CATEGORY = '!category:example.org'
  const SYNCED = '!synced:example.org'
  const CUSTOM = '!custom:example.org'
  const TOP = '!top:example.org'
  const OTHER = '!other:example.org'
  type Levels = Record<string, unknown>

  /** Server → [category → [synced, custom], top-level channel, other category → []]. */
  function setupTree(ownLevel = 100) {
    const children: Record<string, string[]> = { [SERVER]: [CATEGORY, TOP, OTHER], [CATEGORY]: [SYNCED, CUSTOM], [OTHER]: [] }
    const levels: Record<string, Levels> = Object.fromEntries(
      [SERVER, CATEGORY, SYNCED, CUSTOM, TOP, OTHER].map((id) => [id, structuredClone({ ...DEFAULT_LEVELS, users: { [USER]: 100 } })]),
    )
    levels[CUSTOM] = { ...levels[CUSTOM], kick: 100 }
    const rooms = Object.fromEntries(Object.keys(levels).map((id) => [id, {
      roomId: id,
      isSpaceRoom: () => id in children,
      getMember: () => ({ powerLevel: ownLevel }),
      getJoinRule: () => 'restricted',
      getVersion: () => '11',
      currentState: {
        getStateEvents: (type: string) => {
          if (type === 'm.room.power_levels') return { getContent: () => levels[id] }
          if (type !== 'm.space.child') return null
          return (children[id] ?? []).map((child) => ({
            getContent: () => ({ via: ['example.org'] }), getStateKey: () => child, getTs: () => 0,
          }))
        },
      },
    }]))
    const fake = {
      getUserId: vi.fn(() => USER),
      getDomain: vi.fn(() => 'example.org'),
      getRoom: vi.fn((id: string) => rooms[id] ?? null),
      createRoom: vi.fn().mockResolvedValue({ room_id: '!new:example.org' }),
      sendStateEvent: vi.fn(async (id: string, type: string, content: Levels, stateKey: string) => {
        if (type === 'm.room.power_levels') levels[id] = content
        if (type === 'm.space.child') {
          const list = children[id].filter((child) => child !== stateKey)
          children[id] = Object.keys(content).length ? [...list, stateKey] : list
        }
      }),
    }
    const client = fake as unknown as MatrixClient
    const powerLevelWrites = () => fake.sendStateEvent.mock.calls.filter(([, type]) => type === 'm.room.power_levels').map(([id]) => id)
    return { fake, client, levels, rooms, powerLevelWrites }
  }

  it('reports whether a room follows its category or the server', () => {
    const { client } = setupTree()
    expect(readPermissionParent(client, SERVER, SYNCED)).toEqual({ roomId: CATEGORY, synced: true })
    expect(readPermissionParent(client, SERVER, CUSTOM)).toEqual({ roomId: CATEGORY, synced: false })
    expect(readPermissionParent(client, SERVER, CATEGORY)).toEqual({ roomId: SERVER, synced: true })
    expect(readPermissionParent(client, SERVER, SERVER)).toBeNull()
  })

  it('writes one event per room into the category and its synced channels only', async () => {
    const { client, rooms, levels, powerLevelWrites } = setupTree()
    const next = { ...readRoomPermissions(rooms[CATEGORY] as never), sendMessages: 50, ban: 100 }
    await expect(savePermissions(client, { serverId: SERVER, roomId: CATEGORY, levels: next })).resolves.toEqual({ followers: 1, failed: 0 })
    expect(powerLevelWrites()).toEqual([CATEGORY, SYNCED])
    expect(readRoomPermissions(rooms[SYNCED] as never)).toEqual(next)
    expect(levels[CUSTOM]).toMatchObject({ kick: 100, ban: 50 })
    expect(levels[SYNCED]).toMatchObject({ users: { [USER]: 100 }, events: { ...ADMIN_EVENTS, 'm.room.message': 50 } })
  })

  it('passes server defaults on to synced categories and their synced channels', async () => {
    const { client, rooms, powerLevelWrites } = setupTree()
    const next = { ...readRoomPermissions(rooms[SERVER] as never), invite: 50 }
    await expect(savePermissions(client, { serverId: SERVER, roomId: SERVER, levels: next })).resolves.toEqual({ followers: 4, failed: 0 })
    const [first, ...followers] = powerLevelWrites()
    expect(first).toBe(SERVER)
    expect(followers.sort()).toEqual([CATEGORY, SYNCED, TOP, OTHER].sort())
  })

  it('sends nothing without changes and refuses thresholds above the own level', async () => {
    const { fake, client, rooms } = setupTree(50)
    const current = readRoomPermissions(rooms[CATEGORY] as never)
    await expect(savePermissions(client, { serverId: SERVER, roomId: CATEGORY, levels: current })).resolves.toEqual({ followers: 0, failed: 0 })
    await expect(savePermissions(client, { serverId: SERVER, roomId: CATEGORY, levels: { ...current, kick: 100 } })).rejects.toThrow('above your own')
    expect(fake.sendStateEvent).not.toHaveBeenCalled()
  })

  it('counts followers it may not change and continues', async () => {
    const { fake, client, rooms } = setupTree()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    fake.sendStateEvent.mockImplementation(async (id: string) => {
      if (id === CATEGORY) throw new Error('Forbidden')
    })
    try {
      const next = { ...readRoomPermissions(rooms[SERVER] as never), invite: 50 }
      await expect(savePermissions(client, { serverId: SERVER, roomId: SERVER, levels: next })).resolves.toEqual({ followers: 3, failed: 1 })
    } finally {
      info.mockRestore()
    }
  })

  it('syncs a custom channel with its category', async () => {
    const { client, rooms, powerLevelWrites } = setupTree()
    await syncPermissionsWithParent(client, SERVER, CUSTOM)
    expect(powerLevelWrites()).toEqual([CUSTOM])
    expect(readRoomPermissions(rooms[CUSTOM] as never)).toEqual(readRoomPermissions(rooms[CATEGORY] as never))
  })

  it('makes a synced channel follow its new category when moved, but keeps custom ones', async () => {
    const { client, levels, powerLevelWrites } = setupTree()
    levels[OTHER] = { ...levels[OTHER], redact: 0 }
    await moveChild(client, { roomId: SYNCED, fromParentId: CATEGORY, toParentId: OTHER, beforeRoomId: null })
    await moveChild(client, { roomId: CUSTOM, fromParentId: CATEGORY, toParentId: OTHER, beforeRoomId: null })
    expect(powerLevelWrites()).toEqual([SYNCED])
    expect(levels[SYNCED]).toMatchObject({ redact: 0 })
    expect(levels[CUSTOM]).toMatchObject({ redact: 50, kick: 100 })
  })

  it('does not sync when reordering within a category or when asked not to', async () => {
    const { client, levels, powerLevelWrites } = setupTree()
    levels[OTHER] = { ...levels[OTHER], redact: 0 }
    await moveChild(client, { roomId: SYNCED, fromParentId: CATEGORY, toParentId: CATEGORY, beforeRoomId: CUSTOM })
    await moveChild(client, { roomId: SYNCED, fromParentId: CATEGORY, toParentId: OTHER, beforeRoomId: null, syncPermissions: false })
    expect(powerLevelWrites()).toEqual([])
  })

  it('reads calls in spaces without an explicit level as open to members', () => {
    const { client, levels, rooms } = setupTree()
    levels[SERVER] = { state_default: 50 }
    levels[TOP] = { state_default: 50 }
    expect(readRoomPermissions(rooms[SERVER] as never).joinCalls).toBe(0)
    expect(readRoomPermissions(rooms[TOP] as never).joinCalls).toBe(50)
    expect(readPermissionParent(client, SERVER, TOP)?.synced).toBe(false)
  })

  it('creates channels with the permissions of their category', async () => {
    const { fake, client, levels } = setupTree()
    levels[CATEGORY] = { ...levels[CATEGORY], events_default: 50, events: { ...ADMIN_EVENTS, [CALL_MEMBER_EVENT_TYPE]: 50, 'm.room.message': 50 } }
    await createChannel(client, { serverId: SERVER, parentId: CATEGORY, name: 'news', isPrivate: false, encrypted: false })
    const [request] = fake.createRoom.mock.calls[0]
    expect(readPermissionLevels(request.power_level_content_override)).toMatchObject({ sendMessages: 50, joinCalls: 50 })
    expect(request.power_level_content_override.events).toMatchObject(ADMIN_EVENTS)
  })
})

describe('custom roles', () => {
  const BOB = '@bob:example.org'
  const CAROL = '@carol:example.org'
  const OWNER = '@owner:example.org'
  const LOBBY = '!lobby:example.org'
  type Levels = { users?: Record<string, number>; [key: string]: unknown }
  const CUSTOM = [{ id: 'stream', name: 'Streamer', level: 75 }, { id: 'events', name: 'Events', level: 25 }]

  /** Server with two channels; Bob is in both, Carol only in the server, the owner is a v12 creator. */
  function setupRoles(ownLevel = 100) {
    const levels: Record<string, Levels> = Object.fromEntries([SERVER, CHANNEL, LOBBY].map((id) => [id, structuredClone({
      ...DEFAULT_LEVELS, users: { [USER]: ownLevel, [BOB]: 25 },
      events: { ...DEFAULT_LEVELS.events, 'm.room.message': 25 }, events_default: 25,
    })]))
    const state: Record<string, { content: Record<string, unknown> }> = {
      [`${ROLES_EVENT}|`]: { content: { roles: CUSTOM } },
      [`${MEMBER_ROLES_EVENT}|user:${BOB}`]: { content: { roles: ['events'] } },
    }
    const members: Record<string, string[]> = { [SERVER]: [USER, BOB, CAROL, OWNER], [CHANNEL]: [USER, BOB], [LOBBY]: [USER, BOB] }
    const rooms = Object.fromEntries(Object.keys(levels).map((id) => {
      const member = (userId: string) => members[id].includes(userId)
        ? { userId, membership: 'join', powerLevel: userId === OWNER ? Infinity : (levels[id].users?.[userId] ?? 0) }
        : null
      return [id, {
        roomId: id,
        isSpaceRoom: () => id === SERVER,
        getMember: member,
        getMembers: () => members[id].map(member),
        currentState: {
          maySendStateEvent: () => true,
          getStateEvents: (type: string, stateKey?: string) => {
            if (type === 'm.room.power_levels') return { getContent: () => levels[id] }
            if (type === 'm.space.child') {
              return id === SERVER ? [CHANNEL, LOBBY].map((child) => ({ getContent: () => ({ via: ['example.org'] }), getStateKey: () => child, getTs: () => 0 })) : []
            }
            if (id !== SERVER) return stateKey === undefined ? [] : null
            const event = (key: string) => ({ getSender: () => USER, getContent: () => state[`${type}|${key}`].content, getStateKey: () => key })
            if (stateKey === undefined) {
              return Object.keys(state).filter((key) => key.startsWith(`${type}|`)).map((key) => event(key.slice(type.length + 1)))
            }
            return state[`${type}|${stateKey}`] ? event(stateKey) : null
          },
        },
      }]
    }))
    const fake = {
      getUserId: vi.fn(() => USER),
      getRoom: vi.fn((id: string) => rooms[id] ?? null),
      sendStateEvent: vi.fn(async (id: string, type: string, content: Levels, stateKey: string) => {
        if (type === 'm.room.power_levels') levels[id] = content
        else state[`${type}|${stateKey}`] = { content }
      }),
    }
    const client = fake as unknown as MatrixClient
    const writes = () => fake.sendStateEvent.mock.calls.map(([id, type]) => `${type}@${id}`)
    return { fake, client, levels, state, writes, rooms }
  }

  it('reads assigned roles, falling back to the role of the power level', () => {
    const { client, levels } = setupRoles()
    expect(readMemberRoleIds(client, SERVER, BOB)).toEqual(['events'])
    expect(readMemberRoleIds(client, SERVER, CAROL)).toEqual([])
    levels[SERVER].users![BOB] = 50
    expect(readMemberRoleIds(client, SERVER, BOB)).toEqual(['moderator'])
  })

  it('assigns several roles with one event per room, the server first', async () => {
    const { fake, client, levels, state, writes } = setupRoles()
    await expect(setMemberRoles(client, SERVER, BOB, ['events', 'stream', 'member', 'unknown'])).resolves.toEqual({ failed: 0 })
    expect(writes()).toEqual([`m.room.power_levels@${SERVER}`, `${MEMBER_ROLES_EVENT}@${SERVER}`, `m.room.power_levels@${CHANNEL}`, `m.room.power_levels@${LOBBY}`])
    expect(state[`${MEMBER_ROLES_EVENT}|user:${BOB}`].content).toEqual({ roles: ['events', 'stream'] })
    // Admins can't send state keys that start with someone else's user ID.
    expect(fake.sendStateEvent).toHaveBeenCalledWith(SERVER, MEMBER_ROLES_EVENT, { roles: ['events', 'stream'] }, `user:${BOB}`)
    for (const id of [SERVER, CHANNEL, LOBBY]) expect(levels[id].users?.[BOB]).toBe(75)
    // Older servers get the role metadata restricted to admins in the same event.
    expect(levels[SERVER].events).toMatchObject({ [ROLES_EVENT]: 100, [MEMBER_ROLES_EVENT]: 100 })
    expect(levels[CHANNEL].events).not.toHaveProperty(ROLES_EVENT)
  })

  it('only writes the server for members who are not in the channels, and removes default levels', async () => {
    const { client, levels, writes } = setupRoles()
    await setMemberRoles(client, SERVER, CAROL, ['events'])
    expect(writes()).toEqual([`m.room.power_levels@${SERVER}`, `${MEMBER_ROLES_EVENT}@${SERVER}`])
    expect(levels[SERVER].users?.[CAROL]).toBe(25)
    await setMemberRoles(client, SERVER, BOB, [])
    expect(levels[CHANNEL].users).not.toHaveProperty(BOB)
  })

  it('refuses roles above the own level and leaves higher members alone', async () => {
    const { client, fake } = setupRoles(50)
    await expect(setMemberRoles(client, SERVER, BOB, ['stream'])).rejects.toThrow('above your own')
    expect(fake.sendStateEvent).not.toHaveBeenCalled()
    const owner = setupRoles()
    await setMemberRoles(owner.client, SERVER, OWNER, ['events'])
    expect(owner.levels[SERVER].users).not.toHaveProperty(OWNER)
  })

  it('moves members and permission thresholds with a role that changes level', async () => {
    const { client, levels, rooms, state, writes } = setupRoles()
    const roles = readRoles(rooms[SERVER] as never).map((role) => (role.id === 'events' ? { ...role, level: 40, name: 'Event team' } : role))
    await expect(saveServerRoles(client, SERVER, roles)).resolves.toEqual({ failed: 0 })
    expect(writes()).toEqual([`m.room.power_levels@${SERVER}`, `${ROLES_EVENT}@${SERVER}`, `m.room.power_levels@${CHANNEL}`, `m.room.power_levels@${LOBBY}`])
    expect(readRoles(rooms[SERVER] as never).find((role) => role.id === 'events')).toMatchObject({ level: 40, name: 'Event team' })
    expect(state[`${ROLES_EVENT}|`].content.roles).toContainEqual({ id: 'events', name: 'Event team', level: 40, hoist: false })
    for (const id of [SERVER, CHANNEL, LOBBY]) {
      expect(levels[id].users?.[BOB]).toBe(40)
      expect(levels[id]).toMatchObject({ events_default: 40, events: { 'm.room.message': 40, 'm.reaction': 40 } })
    }
  })

  it('gives the permissions of a deleted role to the next higher role and drops its members a level', async () => {
    const { client, levels, rooms } = setupRoles()
    levels[SERVER].users![CAROL] = 75 // Streamer, given in Element without NexSpeak's metadata.
    const roles = readRoles(rooms[SERVER] as never).filter((role) => role.id !== 'events' && role.id !== 'stream')
    await saveServerRoles(client, SERVER, roles)
    expect(levels[SERVER].users).not.toHaveProperty(BOB)
    expect(levels[SERVER].users?.[CAROL]).toBe(50)
    expect(levels[CHANNEL]).toMatchObject({ events_default: 50 })
  })

  it('does not touch members whose level was changed elsewhere, and sends no power levels for a rename', async () => {
    const { client, levels, rooms, writes } = setupRoles()
    levels[SERVER].users![BOB] = 50
    const roles = readRoles(rooms[SERVER] as never).map((role) => (role.id === 'events' ? { ...role, name: 'Renamed' } : role))
    levels[SERVER].events = { ...(levels[SERVER].events as object), [ROLES_EVENT]: 100, [MEMBER_ROLES_EVENT]: 100 }
    await saveServerRoles(client, SERVER, roles)
    expect(writes()).toEqual([`${ROLES_EVENT}@${SERVER}`])
  })
})
