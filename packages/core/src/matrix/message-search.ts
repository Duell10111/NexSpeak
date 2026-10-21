/** Explicit, paginated homeserver search. No local index or background work. */
import { EventType, MatrixEvent, MsgType, SearchOrderBy, type MatrixClient } from 'matrix-js-sdk'

export interface MessageSearchQuery {
  term: string
  /** An explicit scope is required: never search every room on the homeserver. */
  roomIds: string[]
  senderId?: string
  /** Inclusive lower and exclusive upper timestamp bounds, in milliseconds. */
  after?: number
  before?: number
  has?: 'attachment' | 'link'
}

export interface MessageSearchResult {
  event: MatrixEvent
  roomId: string
}

export interface MessageSearchPage {
  results: MessageSearchResult[]
  nextBatch?: string
  /** Homeserver estimate before the client-side date and content filters. */
  total?: number
  excludedEncryptedRooms: number
}

/** Unknown, left and encrypted rooms must never enter the server-side search scope. */
export function getSearchableRoomIds(client: MatrixClient, roomIds: string[]): string[] {
  return [...new Set(roomIds)].filter((roomId) => {
    const room = client.getRoom(roomId)
    return room && room.getMyMembership() === 'join' && !room.isSpaceRoom() &&
      !room.currentState.getStateEvents(EventType.RoomEncryption, '')
  })
}

const ATTACHMENT_TYPES = new Set<string>([MsgType.Image, MsgType.Video, MsgType.Audio, MsgType.File])
const PAGE_SIZE = 30

function matchesContent(event: MatrixEvent, query: MessageSearchQuery): boolean {
  if (event.getType() !== EventType.RoomMessage || event.isRedacted()) return false
  if (query.senderId && event.getSender() !== query.senderId) return false
  if (query.after !== undefined && event.getTs() < query.after) return false
  if (query.before !== undefined && event.getTs() >= query.before) return false
  const content = event.getContent()
  if (typeof content.body !== 'string') return false
  // Search hits for edits are duplicates of the original message, not separate messages.
  if (content['m.relates_to']?.rel_type === 'm.replace') return false
  if (query.has === 'attachment') return ATTACHMENT_TYPES.has(content.msgtype ?? '') && Boolean(content.url || content.file?.url)
  if (query.has === 'link') {
    const body = typeof content.body === 'string' ? content.body : ''
    const html = typeof content.formatted_body === 'string' ? content.formatted_body : ''
    return /\bhttps?:\/\/\S+|\bmatrix:\S+/i.test(body) || /<a\s[^>]*href\s*=\s*["'](?:https?:\/\/|matrix:)/i.test(html)
  }
  return true
}

/**
 * Fetch one page, only on user request. Date/content filters are applied to this page locally:
 * an empty page can still have a nextBatch token. The caller chooses whether to fetch it.
 * Encrypted rooms are excluded before transmitting the term; decrypted messages are never
 * uploaded or indexed. Pass the same query together with nextBatch for subsequent pages.
 */
export async function searchMessages(
  client: MatrixClient,
  query: MessageSearchQuery,
  nextBatch?: string,
  signal?: AbortSignal,
): Promise<MessageSearchPage> {
  const scope = getSearchableRoomIds(client, query.roomIds)
  const excludedEncryptedRooms = [...new Set(query.roomIds)].filter((roomId) =>
    Boolean(client.getRoom(roomId)?.currentState.getStateEvents(EventType.RoomEncryption, '')),
  ).length
  const empty: MessageSearchPage = { results: [], excludedEncryptedRooms }
  const term = query.term.trim()
  if (!term || scope.length === 0 || signal?.aborted) return empty
  if (query.after !== undefined && query.before !== undefined && query.after >= query.before) return empty

  const response = await client.search({
    next_batch: nextBatch,
    body: {
      search_categories: {
        room_events: {
          search_term: term,
          keys: ['content.body'],
          order_by: SearchOrderBy.Recent,
          filter: {
            rooms: scope,
            types: [EventType.RoomMessage],
            limit: PAGE_SIZE,
            ...(query.senderId && { senders: [query.senderId] }),
          },
        },
      },
    },
  }, signal)
  if (signal?.aborted) return empty
  // Recheck room encryption after the request, including a possible state change in flight.
  const allowedRooms = new Set(getSearchableRoomIds(client, scope))
  const seen = new Set<string>()
  const page = response.search_categories.room_events
  const results: MessageSearchResult[] = []
  for (const hit of (page.results ?? []).slice(0, PAGE_SIZE)) {
    const raw = hit.result
    if (!allowedRooms.has(raw.room_id) || !raw.event_id || seen.has(raw.event_id)) continue
    seen.add(raw.event_id)
    const event = new MatrixEvent(raw)
    const sender = event.getSender()
    if (sender && client.isUserIgnored(sender)) continue
    if (matchesContent(event, query)) results.push({ event, roomId: raw.room_id })
  }
  return {
    results,
    nextBatch: page.next_batch,
    total: page.count,
    excludedEncryptedRooms,
  }
}
