/**
 * The thread list of a room. The SDK keeps the threads it has seen; the full list comes from the
 * server's thread API, fetched once per room when the list is first opened.
 */

import type { Room, Thread } from 'matrix-js-sdk'
import { isIgnoredEvent } from './safety'

const fetched = new WeakMap<Room, Promise<void>>()

export function fetchThreadList(room: Room): Promise<void> {
  let promise = fetched.get(room)
  if (!promise) {
    promise = room
      .createThreadsTimelineSets()
      .then(() => room.fetchRoomThreads())
      .catch((error: unknown) => {
        fetched.delete(room)
        throw error
      })
    fetched.set(room, promise)
  }
  return promise
}

function latestActivity(thread: Thread): number {
  return thread.replyToEvent?.getTs() ?? thread.rootEvent?.getTs() ?? 0
}

/** Threads with a root we can show, most recently active first. */
export function sortedThreads(room: Room): Thread[] {
  return room
    .getThreads()
    .filter((thread) => thread.rootEvent && !thread.rootEvent.isRedacted() && !isIgnoredEvent(room.client, thread.rootEvent))
    .sort((a, b) => latestActivity(b) - latestActivity(a))
}

/**
 * Opening a thread view creates the thread object right away (as Element does), so the SDK has
 * finished setting it up before the first reply arrives; otherwise that reply can get lost from
 * the thread's timeline when a new thread is started here.
 */
export function ensureThread(room: Room, rootId: string): Thread | null {
  const existing = room.getThread(rootId)
  if (existing) return existing
  const root = room.findEventById(rootId)
  return root ? room.createThread(rootId, root, [], true) : null
}
