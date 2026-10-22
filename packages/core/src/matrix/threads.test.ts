import { describe, expect, it } from 'vitest'
import { MatrixEvent, type Room, type Thread } from 'matrix-js-sdk'
import { sortedThreads } from './threads'

describe('visible threads', () => {
  it('excludes roots from ignored authors and restores them after unignoring', () => {
    const root = new MatrixEvent({ type: 'm.room.message', event_id: '$root', sender: '@bob:test', content: { body: 'Hidden root' } })
    const thread = { rootEvent: root } as Thread
    let ignored = true
    const room = { getThreads: () => [thread], client: { isUserIgnored: () => ignored } } as unknown as Room
    expect(sortedThreads(room)).toEqual([])
    ignored = false
    expect(sortedThreads(room)).toEqual([thread])
  })
})
