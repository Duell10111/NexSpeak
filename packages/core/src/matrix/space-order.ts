/**
 * Ordering of space children (channels and categories of a server) as the spec defines it:
 * `order` strings from m.space.child compared lexicographically, children without one after
 * them by link time, then by room ID. Moving a child usually needs a single new order string.
 */

export interface SpaceChildLink {
  roomId: string
  order?: string
  /** origin_server_ts of the m.space.child event. */
  ts: number
  via: string[]
}

const MIN_CODE = 0x20
const BASE = 0x7e - MIN_CODE + 1
const MAX_LENGTH = 50

export function isValidOrder(order: unknown): order is string {
  return typeof order === 'string' && order.length > 0 && order.length <= MAX_LENGTH && /^[\x20-\x7e]+$/.test(order)
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function sortSpaceChildren<T extends SpaceChildLink>(links: T[]): T[] {
  return [...links].sort((a, b) => {
    if (a.order && b.order) return compareStrings(a.order, b.order) || compareStrings(a.roomId, b.roomId)
    if (a.order) return -1
    if (b.order) return 1
    return a.ts - b.ts || compareStrings(a.roomId, b.roomId)
  })
}

/**
 * A string strictly between `a` and `b` (b = null: no upper bound), or null if there is none
 * within the length limit. Treats the strings as base-95 fractions.
 */
export function orderBetween(a: string, b: string | null): string | null {
  let prefix = ''
  let upperOpen = b === null
  for (let i = 0; i < MAX_LENGTH; i += 1) {
    const aExhausted = i >= a.length
    const da = aExhausted ? 0 : a.charCodeAt(i) - MIN_CODE
    const bExhausted = !upperOpen && i >= b!.length
    const db = upperOpen ? BASE : bExhausted ? 0 : b!.charCodeAt(i) - MIN_CODE

    if (db < da || (aExhausted && bExhausted)) return null
    if (db - da > 1) return prefix + String.fromCharCode(MIN_CODE + Math.floor((da + db) / 2))
    // Equal digits, or adjacent ones: everything after a's digit fits below b from here on.
    if (db - da === 1) upperOpen = true
    prefix += String.fromCharCode(MIN_CODE + da)
  }
  return null
}

/** `count` evenly spread order strings, never ending in a space. */
export function evenOrders(count: number): string[] {
  const span = BASE * BASE
  return Array.from({ length: count }, (_, index) => {
    const value = Math.max(1, Math.round(((index + 1) * span) / (count + 1)))
    const high = Math.floor(value / BASE)
    const low = value % BASE
    return low === 0
      ? String.fromCharCode(MIN_CODE + high)
      : String.fromCharCode(MIN_CODE + high) + String.fromCharCode(MIN_CODE + low)
  })
}

/**
 * New order strings so that `movingId` sits before `beforeId` (null: at the end) among
 * `siblings`. Usually only the moved child changes; if there is no room between its new
 * neighbours (or they have no order yet), all siblings are renumbered.
 */
export function planMove(
  siblings: SpaceChildLink[],
  movingId: string,
  beforeId: string | null,
): Array<{ roomId: string; order: string }> {
  const others = sortSpaceChildren(siblings).filter((link) => link.roomId !== movingId)
  const found = beforeId ? others.findIndex((link) => link.roomId === beforeId) : -1
  const index = found === -1 ? others.length : found

  if (others.every((link) => link.order)) {
    const order = orderBetween(others[index - 1]?.order ?? '', others[index]?.order ?? null)
    if (order) return [{ roomId: movingId, order }]
  }

  const current = new Map(siblings.map((link) => [link.roomId, link.order]))
  const sequence = [...others.slice(0, index).map((link) => link.roomId), movingId, ...others.slice(index).map((link) => link.roomId)]
  const orders = evenOrders(sequence.length)
  return sequence
    .map((roomId, position) => ({ roomId, order: orders[position] }))
    .filter((update) => update.roomId === movingId || current.get(update.roomId) !== update.order)
}
