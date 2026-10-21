import { describe, expect, it, vi } from 'vitest'
import { EventStatus, MatrixEvent, type MatrixClient, type Room } from 'matrix-js-sdk'
import { PollStartEvent } from 'matrix-js-sdk/lib/extensible_events_v1/PollStartEvent.js'
import { PollResponseEvent } from 'matrix-js-sdk/lib/extensible_events_v1/PollResponseEvent.js'
import { M_POLL_END, M_POLL_RESPONSE, M_POLL_START } from 'matrix-js-sdk/lib/@types/polls.js'
import { derivePoll, endPoll, pollFromRoom, sendPoll, voteInPoll } from './polls'
import { eventToMatrixMessage } from './types'

const ROOM = '!room:example.org'
const ALICE = '@alice:example.org'
const BOB = '@bob:example.org'
function event(type: string, content: object, sender = ALICE, ts = 1, id = `$${ts}-${sender}`) {
  return new MatrixEvent({ type, content: content as Record<string, unknown>, room_id: ROOM, sender, event_id: id, origin_server_ts: ts })
}
function root(multiple = false, disclosed = true) {
  const serialized = PollStartEvent.from('When?', ['Today', 'Tomorrow'], disclosed ? 'm.poll.disclosed' : 'm.poll.undisclosed', multiple ? 2 : 1).serialize()
  return event(serialized.type, serialized.content, ALICE, 1, '$poll')
}
function vote(poll: MatrixEvent, sender: string, answers: string[], ts: number) {
  const serialized = PollResponseEvent.from(answers, poll.getId()!).serialize()
  return event(serialized.type, serialized.content, sender, ts)
}
function end(sender: string, ts: number) {
  return event(M_POLL_END.name, { [M_POLL_END.name]: {}, 'm.relates_to': { rel_type: 'm.reference', event_id: '$poll' } }, sender, ts)
}
function roomMock(relations: MatrixEvent[] = [], moderators: string[] = []): Room {
  return {
    currentState: { maySendRedactionForEvent: (_root: MatrixEvent, sender: string) => moderators.includes(sender) },
    relations: { getChildEventsForEvent: (_id: string, _rel: string, type: string) => ({ getRelations: () => relations.filter((event) => event.getType() === type) }) },
    getPendingEvents: () => [],
  } as unknown as Room
}
function answerIds(poll: MatrixEvent) { return derivePoll(poll, [])!.answers.map((answer) => answer.id) }

describe('Matrix polls', () => {
  it('counts the latest vote per sender regardless of arrival order and deduplicates multiple selections', () => {
    const poll = root(true)
    const [a, b] = answerIds(poll)
    const results = derivePoll(poll, [vote(poll, BOB, [b, b], 5), vote(poll, ALICE, [a, b], 3), vote(poll, BOB, [a], 2)], undefined, BOB)!
    expect(results.answers.map((answer) => answer.votes)).toEqual([1, 2])
    expect(results.voters).toBe(2)
    expect(results.ownAnswers).toEqual([b])
  })

  it('treats a latest spoiled vote as replacing the previous vote and truncates extra valid selections', () => {
    const poll = root()
    const [a, b] = answerIds(poll)
    const results = derivePoll(poll, [vote(poll, ALICE, [a, b], 2), vote(poll, BOB, [a], 3), vote(poll, BOB, ['unknown'], 4)])!
    expect(results.answers.map((answer) => answer.votes)).toEqual([1, 0])
    expect(results.voters).toBe(1)
  })

  it('ignores redacted, failed and unrelated responses and restores the earlier vote after redaction', () => {
    const poll = root()
    const [a, b] = answerIds(poll)
    const failed = vote(poll, ALICE, [b], 3)
    failed.status = EventStatus.NOT_SENT
    const redacted = vote(poll, ALICE, [b], 4)
    redacted.makeRedacted(event('m.room.redaction', {}, ALICE, 5), roomMock())
    const unrelated = event(M_POLL_RESPONSE.name, { [M_POLL_RESPONSE.name]: { answers: [b] }, 'm.relates_to': { rel_type: 'm.reference', event_id: '$other' } }, BOB, 6)
    const results = derivePoll(poll, [vote(poll, ALICE, [a], 2), failed, redacted, unrelated])!
    expect(results.answers.map((answer) => answer.votes)).toEqual([1, 0])
  })

  it('uses the first authorized end, includes votes at its timestamp and ignores later votes', () => {
    const poll = root()
    const [a, b] = answerIds(poll)
    const room = roomMock([], ['@mod:example.org'])
    const results = derivePoll(poll, [end(BOB, 2), vote(poll, BOB, [a], 3), end(ALICE, 7), end('@mod:example.org', 4), vote(poll, ALICE, [b], 4), vote(poll, BOB, [b], 6)], room, '@mod:example.org')!
    expect(results).toMatchObject({ ended: true, canEnd: true, voters: 2 })
    expect(results.answers.map((answer) => answer.votes)).toEqual([1, 1])
    expect(derivePoll(poll, [], room, BOB)?.canEnd).toBe(false)
  })

  it('supports stable and Element unstable event namespaces together', () => {
    const poll = event('m.poll.start', { 'm.poll.start': { question: { 'm.text': 'Stable?' }, kind: 'm.poll.disclosed', max_selections: 1, answers: [{ id: 'yes', 'm.text': 'Yes' }, { id: 'no', 'm.text': 'No' }] } }, ALICE, 1, '$poll')
    const stableVote = event('m.poll.response', { 'm.poll.response': { answers: ['yes'] }, 'm.relates_to': { rel_type: 'm.reference', event_id: '$poll' } }, BOB, 2)
    const results = derivePoll(poll, [stableVote, vote(poll, ALICE, ['no'], 3)])!
    expect(results).toMatchObject({ question: 'Stable?', disclosed: true, voters: 2 })
    expect(results.answers.map((answer) => answer.votes)).toEqual([1, 1])
    expect(eventToMatrixMessage(poll, ROOM)).toMatchObject({ kind: 'poll', body: 'Stable?' })
    expect(eventToMatrixMessage(stableVote, ROOM)).toBeNull()
    expect(eventToMatrixMessage(end(ALICE, 4), ROOM)).toBeNull()
  })

  it('defaults unknown kinds to hidden results and handles malformed starts without crashing the timeline', () => {
    const malformed = event('m.poll.start', { 'm.poll.start': { question: {} } })
    expect(derivePoll(malformed, [])).toBeUndefined()
    expect(eventToMatrixMessage(malformed, ROOM)).toMatchObject({ kind: 'unsupported' })
    expect(derivePoll(root(false, false), [])?.disclosed).toBe(false)
    const fractional = event('m.poll.start', { 'm.poll.start': { question: { 'm.text': 'Broken?' }, max_selections: 0.5, answers: [{ id: 'yes', 'm.text': 'Yes' }] } })
    expect(derivePoll(fractional, [])).toBeUndefined()
  })

  it('reads only existing SDK relations and pending echoes, without fetching response history', () => {
    const poll = root()
    const [a] = answerIds(poll)
    const room = roomMock([vote(poll, BOB, [a], 2)])
    const pending = vote(poll, ALICE, [a], 3)
    room.getPendingEvents = () => [pending]
    expect(pollFromRoom(poll, room, ALICE)).toMatchObject({ voters: 2, ownAnswers: [a] })
  })

  it('sends SDK poll events through the encryption pipeline and rejects invalid drafts and unauthorized actions', async () => {
    const poll = root()
    const client = { sendEvent: vi.fn().mockResolvedValue({ event_id: '$new' }), getRoom: () => roomMock(), getUserId: () => ALICE } as unknown as MatrixClient
    await sendPoll(client, ROOM, { question: ' Question ', answers: [' Yes ', ' No '], multiple: true, disclosed: false })
    expect(client.sendEvent).toHaveBeenCalledWith(ROOM, M_POLL_START.name, expect.objectContaining({ [M_POLL_START.name]: expect.objectContaining({ max_selections: 2, question: expect.any(Object) }) }))
    await expect(sendPoll(client, ROOM, { question: 'x', answers: ['a'], multiple: false, disclosed: true })).rejects.toThrow('2–20')
    await expect(sendPoll(client, ROOM, { question: 'x', answers: Array(21).fill('a'), multiple: false, disclosed: true })).rejects.toThrow('2–20')
    const [a, b] = answerIds(poll)
    await expect(voteInPoll(client, ROOM, poll, [a, b])).rejects.toThrow('Invalid')
    await voteInPoll(client, ROOM, poll, [a])
    expect(client.sendEvent).toHaveBeenLastCalledWith(ROOM, M_POLL_RESPONSE.name, expect.any(Object))
    await endPoll(client, ROOM, poll, 'Poll ended')
    expect(client.sendEvent).toHaveBeenLastCalledWith(ROOM, M_POLL_END.name, expect.any(Object))
    client.getUserId = () => BOB
    await expect(endPoll(client, ROOM, poll, 'Poll ended')).rejects.toThrow('Cannot end')
  })
})
