/** Matrix MSC3381 polls. Derive results only from relations already held by the SDK. */
import { EventStatus, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk'
import { M_POLL_START, M_POLL_RESPONSE, M_POLL_END, M_POLL_KIND_DISCLOSED, M_POLL_KIND_UNDISCLOSED, type PollStartEventContent, type PollResponseEventContent, type PollEndEventContent } from 'matrix-js-sdk/lib/@types/polls.js'
import { PollStartEvent } from 'matrix-js-sdk/lib/extensible_events_v1/PollStartEvent.js'
import { PollResponseEvent } from 'matrix-js-sdk/lib/extensible_events_v1/PollResponseEvent.js'
import { PollEndEvent } from 'matrix-js-sdk/lib/extensible_events_v1/PollEndEvent.js'

// SDK 44 supports response events at runtime but omits them from its sendEvent map.
declare module 'matrix-js-sdk/lib/@types/event.js' {
  interface TimelineEvents {
    [M_POLL_RESPONSE.name]: PollResponseEventContent
  }
}

export interface PollDraft {
  question: string
  answers: string[]
  multiple: boolean
  disclosed: boolean
}

export interface MatrixPoll {
  question: string
  answers: Array<{ id: string; text: string; votes: number }>
  maxSelections: number
  disclosed: boolean
  ended: boolean
  canEnd: boolean
  ownAnswers: string[]
  voters: number
}

export function isPollStart(event: MatrixEvent): boolean {
  return M_POLL_START.matches(event.getType())
}

export function canEndPoll(room: Room | undefined, root: MatrixEvent, userId: string | null | undefined): boolean {
  return Boolean(userId && (root.getSender() === userId || room?.currentState.maySendRedactionForEvent(root, userId)))
}

const parsed = new WeakMap<MatrixEvent, { content: object; poll: PollStartEvent | null }>()
function parseStart(event: MatrixEvent): PollStartEvent | null {
  const content = event.getContent()
  const cached = parsed.get(event)
  if (cached?.content === content) return cached.poll
  let poll: PollStartEvent | null = null
  try {
    poll = new PollStartEvent({ type: event.getType(), content: content as PollStartEventContent })
    // Ambiguous answer IDs cannot represent a usable poll.
    if (!Number.isInteger(poll.maxSelections) || new Set(poll.answers.map((answer) => answer.id)).size !== poll.answers.length) poll = null
  } catch { /* Malformed events must not break the room timeline. */ }
  parsed.set(event, { content, poll })
  return poll
}

function isLive(event: MatrixEvent): boolean {
  return !event.isRedacted() && !event.isDecryptionFailure() && event.status !== EventStatus.NOT_SENT && event.status !== EventStatus.CANCELLED
}

/** Pure aggregation also used for stable/unstable interoperability and vote validation tests. */
export function derivePoll(root: MatrixEvent, relations: MatrixEvent[], room?: Room, ownUserId?: string | null): MatrixPoll | undefined {
  const poll = parseStart(root)
  if (!poll) return undefined
  const related = relations.filter((event) => isLive(event) && event.getRelation()?.rel_type === 'm.reference' && event.getRelation()?.event_id === root.getId())
  const end = related.filter((event) => M_POLL_END.matches(event.getType()) && canEndPoll(room, root, event.getSender()))
    .reduce<MatrixEvent | undefined>((earliest, event) => !earliest || event.getTs() < earliest.getTs() ? event : earliest, undefined)
  const latest = new Map<string, MatrixEvent>()
  for (const event of related) {
    const sender = event.getSender()
    if (!sender || !M_POLL_RESPONSE.matches(event.getType()) || (end && event.getTs() > end.getTs())) continue
    const previous = latest.get(sender)
    if (!previous || event.getTs() > previous.getTs() || (event.getTs() === previous.getTs() && (event.getId() ?? '') > (previous.getId() ?? ''))) latest.set(sender, event)
  }
  const counts = new Map<string, number>()
  let voters = 0
  let ownAnswers: string[] = []
  for (const [sender, event] of latest) {
    try {
      const response = new PollResponseEvent({ type: event.getType(), content: event.getContent() })
      response.validateAgainst(poll)
      if (response.spoiled) continue
      const answers = [...new Set(response.answerIds)]
      if (sender === ownUserId) ownAnswers = answers
      voters++
      for (const id of answers) counts.set(id, (counts.get(id) ?? 0) + 1)
    } catch { /* The latest malformed vote spoils that user's previous vote too. */ }
  }
  return {
    question: poll.question.text,
    answers: poll.answers.map((answer) => ({ id: answer.id, text: answer.text, votes: counts.get(answer.id) ?? 0 })),
    maxSelections: Math.min(poll.answers.length, Math.floor(poll.maxSelections)),
    disclosed: M_POLL_KIND_DISCLOSED.matches(poll.rawKind),
    ended: Boolean(end),
    canEnd: canEndPoll(room, root, ownUserId),
    ownAnswers,
    voters,
  }
}

export function pollFromRoom(root: MatrixEvent, room?: Room, ownUserId?: string | null): MatrixPoll | undefined {
  const eventId = root.getId()
  const relations: MatrixEvent[] = []
  if (room && eventId) {
    for (const type of [M_POLL_RESPONSE.name, M_POLL_RESPONSE.altName, M_POLL_END.name, M_POLL_END.altName]) {
      if (type) relations.push(...(room.relations.getChildEventsForEvent(eventId, 'm.reference', type)?.getRelations() ?? []))
    }
    // Detached local echoes are not guaranteed to have reached the relation container yet.
    relations.push(...room.getPendingEvents().filter((event) => event.getRelation()?.event_id === eventId))
  }
  return derivePoll(root, relations, room, ownUserId)
}

/** sendEvent uses the SDK encryption/local echo pipeline for all three poll event types. */
export function sendPoll(client: MatrixClient, roomId: string, draft: PollDraft): Promise<unknown> {
  const question = draft.question.trim()
  const answers = draft.answers.map((answer) => answer.trim())
  if (!question || answers.length < 2 || answers.length > 20 || answers.some((answer) => !answer)) return Promise.reject(new Error('A poll needs a question and 2–20 non-empty answers'))
  const event = PollStartEvent.from(question, answers, draft.disclosed ? M_POLL_KIND_DISCLOSED : M_POLL_KIND_UNDISCLOSED, draft.multiple ? answers.length : 1).serialize()
  return client.sendEvent(roomId, M_POLL_START.name, event.content as PollStartEventContent)
}

export function voteInPoll(client: MatrixClient, roomId: string, root: MatrixEvent, answers: string[]): Promise<unknown> {
  const poll = pollFromRoom(root, client.getRoom(roomId) ?? undefined, client.getUserId())
  if (!root.getId() || !poll || poll.ended || answers.length < 1 || answers.length > poll.maxSelections || new Set(answers).size !== answers.length || answers.some((id) => !poll.answers.some((answer) => answer.id === id))) return Promise.reject(new Error('Invalid poll vote'))
  const event = PollResponseEvent.from(answers, root.getId()!).serialize()
  return client.sendEvent(roomId, M_POLL_RESPONSE.name, event.content as PollResponseEventContent)
}

export function endPoll(client: MatrixClient, roomId: string, root: MatrixEvent, message: string): Promise<unknown> {
  const poll = pollFromRoom(root, client.getRoom(roomId) ?? undefined, client.getUserId())
  if (!root.getId() || !poll?.canEnd || poll.ended) return Promise.reject(new Error('Cannot end this poll'))
  const event = PollEndEvent.from(root.getId()!, message).serialize()
  return client.sendEvent(roomId, M_POLL_END.name, event.content as PollEndEventContent)
}
