import { describe, expect, it, vi } from 'vitest'
import type { MatrixClient } from 'matrix-js-sdk'
import { canRepairServerPermissions, createCategory, createChannel, createServer, repairServerPermissions } from './server'
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
    const levels = { getContent: () => ({ users }) }
    const server = {
      getVersion: () => version,
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
