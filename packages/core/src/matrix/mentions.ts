/**
 * Candidates for the composer's mention autocompletion: people of the room (@), rooms (#) and
 * the whole room (@room, for those allowed to notify everybody).
 */

import type { MatrixClient, Room } from 'matrix-js-sdk'
import { roomPermalink, userPermalink } from './links'
import type { MessageMention } from './messages'

export interface MentionCandidate extends MessageMention {
  /** Stable key for lists. */
  id: string
  kind: 'user' | 'room' | 'everyone'
  label: string
  /** Secondary line: the user id or the room alias. */
  detail?: string
  avatarMxc?: string
}

export const MAX_MENTION_CANDIDATES = 8
export const ROOM_MENTION = '@room'

/** The "@query" or "#query" right before the caret, if any. */
export function findMentionTrigger(text: string, caret: number): { trigger: '@' | '#'; query: string; start: number } | null {
  const match = /(^|\s)([@#])([^\s@#]{0,64})$/.exec(text.slice(0, caret))
  if (!match) return null
  return { trigger: match[2] as '@' | '#', query: match[3], start: caret - match[3].length - 1 }
}

function matches(query: string, ...values: Array<string | undefined>): number {
  const needle = query.toLowerCase()
  let best = -1
  for (const value of values) {
    const haystack = value?.toLowerCase()
    if (!haystack) continue
    if (haystack.startsWith(needle)) return 2
    if (haystack.includes(needle)) best = 1
  }
  return best
}

function serverOf(id: string): string | undefined {
  const index = id.indexOf(':')
  return index === -1 ? undefined : id.slice(index + 1)
}

export function userCandidates(client: MatrixClient, room: Room, query: string): MentionCandidate[] {
  const ownId = client.getUserId()
  const people = room
    .getJoinedMembers()
    .filter((member) => member.userId !== ownId)
    .map((member) => ({ member, score: matches(query, member.name, member.userId.slice(1)) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score || a.member.name.localeCompare(b.member.name))
    .slice(0, MAX_MENTION_CANDIDATES)
    .map(({ member }): MentionCandidate => ({
      id: member.userId,
      kind: 'user',
      label: member.name,
      detail: member.userId,
      avatarMxc: member.getMxcAvatarUrl() || undefined,
      text: `@${member.name}`,
      href: userPermalink(member.userId),
      userId: member.userId,
    }))

  const mayNotifyRoom = ownId ? room.currentState.mayTriggerNotifOfType('room', ownId) : false
  if (mayNotifyRoom && matches(query, 'room') >= 0) {
    people.push({ id: ROOM_MENTION, kind: 'everyone', label: ROOM_MENTION, text: ROOM_MENTION, href: '' })
  }
  return people
}

export function roomCandidates(client: MatrixClient, query: string): MentionCandidate[] {
  return client
    .getRooms()
    .filter((room) => room.getMyMembership() === 'join' && !room.isSpaceRoom())
    .map((room) => ({ room, score: matches(query, room.name, room.getCanonicalAlias()?.slice(1)) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score || a.room.name.localeCompare(b.room.name))
    .slice(0, MAX_MENTION_CANDIDATES)
    .map(({ room }): MentionCandidate => {
      const alias = room.getCanonicalAlias() ?? undefined
      return {
        id: room.roomId,
        kind: 'room',
        label: room.name,
        detail: alias,
        avatarMxc: room.getMxcAvatarUrl() || undefined,
        text: `#${room.name}`,
        href: roomPermalink(alias ?? room.roomId, serverOf(client.getUserId() ?? '')),
      }
    })
}
