import { describe, expect, it, vi } from 'vitest'
import type { MatrixClient } from 'matrix-js-sdk'
import { createChannel, createServer } from './server'
import { CALL_MEMBER_EVENT_TYPE } from './rtc'

const USER = '@alice:example.org'
const SERVER = '!server:example.org'
const CHANNEL = '!general:example.org'

function setup() {
  const fake = {
    getUserId: vi.fn(() => USER as string | null),
    getDomain: vi.fn(() => 'example.org'),
    // No room has synced yet; creation must not read state to inherit the creator's role.
    getRoom: vi.fn(() => null),
    createRoom: vi.fn().mockResolvedValueOnce({ room_id: SERVER }).mockResolvedValueOnce({ room_id: CHANNEL }),
    uploadContent: vi.fn().mockResolvedValue({ content_uri: 'mxc://example.org/icon' }),
    sendStateEvent: vi.fn().mockResolvedValue({}),
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
          'm.room.power_levels': 100, 'm.room.tombstone': 100, 'm.room.server_acl': 100, [CALL_MEMBER_EVENT_TYPE]: 0,
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

describe('createChannel', () => {
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

  const create = (client: MatrixClient) =>
    createChannel(client, { serverId: SERVER, parentId: SERVER, name: 'news', isPrivate: false, encrypted: false })

  it('keeps v12+ creators admin and never lists the new room creator', async () => {
    const { fake, client } = setupServer('12', { [USER]: 100, '@mod:example.org': 50 })
    await create(client)
    const [request] = fake.createRoom.mock.calls[0]
    expect(request.room_version).toBe('12')
    expect(request.power_level_content_override.users).toEqual({
      [OWNER]: 100, '@co:example.org': 100, '@mod:example.org': 50,
    })
  })

  it('copies the roles of pre-v12 servers unchanged', async () => {
    const { fake, client } = setupServer('11', { [USER]: 100, [OWNER]: 50 })
    await create(client)
    const [request] = fake.createRoom.mock.calls[0]
    expect(request.room_version).toBe('11')
    expect(request.power_level_content_override.users).toEqual({ [USER]: 100, [OWNER]: 50 })
  })
})
