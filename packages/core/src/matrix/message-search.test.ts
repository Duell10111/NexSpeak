import { describe, expect, it, vi } from 'vitest'
import { EventType, type MatrixClient, type Room } from 'matrix-js-sdk'
import { getSearchableRoomIds, searchMessages } from './message-search'

function room(encrypted = false, membership = 'join', space = false): Room {
  return {
    getMyMembership: () => membership,
    isSpaceRoom: () => space,
    currentState: { getStateEvents: () => encrypted ? {} : null },
  } as unknown as Room
}

function hit(id: string, content: Record<string, unknown> = { msgtype: 'm.text', body: 'hello' }, extras = {}) {
  return { result: {
    event_id: id, room_id: '!open:test', sender: '@alice:test', origin_server_ts: 100,
    type: EventType.RoomMessage, content, ...extras,
  } }
}

function setup(results: ReturnType<typeof hit>[] = []) {
  const rooms: Record<string, Room> = {
    '!open:test': room(), '!encrypted:test': room(true), '!left:test': room(false, 'leave'), '!space:test': room(false, 'join', true),
  }
  const search = vi.fn().mockResolvedValue({ search_categories: { room_events: { results, next_batch: 'next', count: 50 } } })
  const client = { getRoom: (id: string) => rooms[id], isUserIgnored: (id: string) => id === '@ignored:test', search } as unknown as MatrixClient
  return { client, search, rooms }
}

describe('message search', () => {
  it('requires explicit joined unencrypted rooms and deduplicates the scope', async () => {
    const { client, search } = setup()
    expect(getSearchableRoomIds(client, ['!open:test', '!open:test', '!encrypted:test', '!left:test', '!space:test', '!unknown:test']))
      .toEqual(['!open:test'])
    await searchMessages(client, { term: 'secret', roomIds: ['!encrypted:test'] })
    await searchMessages(client, { term: 'hello', roomIds: [] })
    await searchMessages(client, { term: '  ', roomIds: ['!open:test'] })
    await searchMessages(client, { term: 'hello', roomIds: ['!open:test'], after: 200, before: 100 })
    const controller = new AbortController()
    controller.abort()
    await searchMessages(client, { term: 'hello', roomIds: ['!open:test'] }, undefined, controller.signal)
    expect(search).not.toHaveBeenCalled()
  })

  it('sends only eligible rooms and filters to the homeserver and forwards pagination and cancellation', async () => {
    const { client, search } = setup([hit('$1')])
    const controller = new AbortController()
    const page = await searchMessages(client, {
      term: ' hello ', roomIds: ['!open:test', '!encrypted:test'], senderId: '@alice:test',
    }, 'previous', controller.signal)
    expect(search).toHaveBeenCalledWith({
      next_batch: 'previous',
      body: { search_categories: { room_events: {
        search_term: 'hello', keys: ['content.body'], order_by: 'recent',
        filter: { rooms: ['!open:test'], types: [EventType.RoomMessage], limit: 30, senders: ['@alice:test'] },
      } } },
    }, controller.signal)
    expect(page.results.map(({ event, roomId }) => [event.getId(), roomId])).toEqual([['$1', '!open:test']])
    expect(page).toMatchObject({ nextBatch: 'next', total: 50, excludedEncryptedRooms: 1 })
  })

  it('rejects out-of-scope, encrypted, redacted, edited, duplicate and non-message hits', async () => {
    const { client } = setup([
      hit('$valid'), hit('$valid'), hit('$other-room', undefined, { room_id: '!encrypted:test' }),
      hit('$wrong-type', undefined, { type: 'm.room.encrypted' }),
      hit('$redacted', {}, { unsigned: { redacted_because: {} } }),
      hit('$edit', { body: '* hello', 'm.relates_to': { rel_type: 'm.replace', event_id: '$valid' } }),
      hit('$ignored', undefined, { sender: '@ignored:test' }),
    ])
    const page = await searchMessages(client, { term: 'hello', roomIds: ['!open:test'] })
    expect(page.results.map(({ event }) => event.getId())).toEqual(['$valid'])
  })

  it('enforces author and inclusive after/exclusive before filters locally', async () => {
    const { client } = setup([
      hit('$early', undefined, { origin_server_ts: 99 }), hit('$start'),
      hit('$end', undefined, { origin_server_ts: 200 }), hit('$other', undefined, { sender: '@bob:test' }),
    ])
    const page = await searchMessages(client, {
      term: 'hello', roomIds: ['!open:test'], senderId: '@alice:test', after: 100, before: 200,
    })
    expect(page.results.map(({ event }) => event.getId())).toEqual(['$start'])
  })

  it('filters attachment types separately from text links and preserves pagination on empty filtered pages', async () => {
    const { client } = setup([
      hit('$text'), hit('$image', { msgtype: 'm.image', body: 'picture', url: 'mxc://test/a' }),
      hit('$link', { msgtype: 'm.text', body: 'https://example.org' }),
      hit('$formatted', { msgtype: 'm.text', body: 'example', formatted_body: '<a href="https://example.org">example</a>' }),
    ])
    const attachments = await searchMessages(client, { term: 'hello', roomIds: ['!open:test'], has: 'attachment' })
    expect(attachments.results.map(({ event }) => event.getId())).toEqual(['$image'])
    const links = await searchMessages(client, { term: 'hello', roomIds: ['!open:test'], has: 'link' })
    expect(links.results.map(({ event }) => event.getId())).toEqual(['$link', '$formatted'])
    const empty = await searchMessages(client, { term: 'hello', roomIds: ['!open:test'], after: 1000 })
    expect(empty).toMatchObject({ results: [], nextBatch: 'next' })
  })

  it('drops in-flight results if the room becomes encrypted or the search is cancelled', async () => {
    const { client, search, rooms } = setup()
    search.mockImplementationOnce(async () => {
      rooms['!open:test'] = room(true)
      return { search_categories: { room_events: { results: [hit('$1')] } } }
    })
    expect((await searchMessages(client, { term: 'hello', roomIds: ['!open:test'] })).results).toEqual([])
    rooms['!open:test'] = room()
    const controller = new AbortController()
    search.mockImplementationOnce(async () => {
      controller.abort()
      return { search_categories: { room_events: { results: [hit('$1')] } } }
    })
    expect((await searchMessages(client, { term: 'hello', roomIds: ['!open:test'] }, undefined, controller.signal)).results).toEqual([])
  })

  it('propagates homeserver errors instead of showing an empty successful search', async () => {
    const { client, search } = setup()
    search.mockRejectedValue(new Error('Search unavailable'))
    await expect(searchMessages(client, { term: 'hello', roomIds: ['!open:test'] })).rejects.toThrow('Search unavailable')
  })

  it('bounds response processing even when a homeserver ignores the requested page size', async () => {
    const { client, search } = setup(Array.from({ length: 100 }, (_, index) => hit(`$${index}`)))
    const page = await searchMessages(client, { term: 'hello', roomIds: ['!open:test'] })
    expect(page.results).toHaveLength(30)
    expect(search).toHaveBeenCalledOnce()
  })

  it('ignores malformed message bodies that cannot be rendered as search snippets', async () => {
    const { client } = setup([
      hit('$object', { body: { nested: 'hello' } }), hit('$number', { body: 42 }),
      hit('$missing', { msgtype: 'm.text' }), hit('$valid'),
    ])
    const page = await searchMessages(client, { term: 'hello', roomIds: ['!open:test'] })
    expect(page.results.map(({ event }) => event.getId())).toEqual(['$valid'])
  })
})
