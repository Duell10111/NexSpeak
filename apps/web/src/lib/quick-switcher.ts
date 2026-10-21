import type { RoomDirectory } from "@/hooks/useRoomDirectory"

export interface QuickDestination {
  id: string
  kind: "server" | "channel" | "direct"
  name: string
  serverId?: string
  serverName?: string
  unread: number
  mentions: number
}

/** Uses the already loaded directory; callers build this only while the switcher is open. */
export function quickDestinations(directory: RoomDirectory): QuickDestination[] {
  const destinations: QuickDestination[] = []
  const seen = new Set<string>()
  for (const server of directory.spaces) {
    destinations.push({ id: server.id, kind: "server", name: server.name, unread: server.unread, mentions: server.mentions })
    for (const room of directory.roomsBySpace[server.id] ?? []) {
      if (seen.has(room.id) || room.membership !== "join") continue
      seen.add(room.id)
      destinations.push({ id: room.id, kind: "channel", name: room.name, serverId: server.id, serverName: server.name, unread: room.unread, mentions: room.highlights })
    }
  }
  for (const [kind, rooms] of [["direct", directory.directRooms], ["channel", directory.otherRooms]] as const) {
    for (const room of rooms) {
      if (seen.has(room.id) || room.membership !== "join") continue
      seen.add(room.id)
      destinations.push({ id: room.id, kind, name: room.name, unread: room.unread, mentions: room.highlights })
    }
  }
  return destinations
}

function normalized(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
}

/** Prefer exact, prefix and substring matches before a loose subsequence. */
function fuzzyScore(value: string, query: string): number {
  if (value === query) return 0
  if (value.startsWith(query)) return 10 + value.length - query.length
  const substring = value.indexOf(query)
  if (substring >= 0) return 100 + substring + value.length - query.length
  let position = 0
  let gaps = 0
  for (const character of query) {
    const next = value.indexOf(character, position)
    if (next < 0) return Infinity
    gaps += next - position
    position = next + 1
  }
  return 1000 + gaps + value.length
}

export function searchQuickDestinations(destinations: QuickDestination[], term: string, recentIds: readonly string[]): QuickDestination[] {
  const query = normalized(term.trim()).replace(/\s+/g, " ")
  const recent = new Map(recentIds.map((id, index) => [id, index]))
  return destinations
    .map((destination, index) => ({
      destination,
      index,
      score: query ? Math.min(
        fuzzyScore(normalized(destination.name), query),
        destination.serverName ? fuzzyScore(normalized(`${destination.serverName} ${destination.name}`), query) + 200 : Infinity,
      ) : 0,
    }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((a, b) => a.score - b.score || (recent.get(a.destination.id) ?? Infinity) - (recent.get(b.destination.id) ?? Infinity) || a.index - b.index)
    .map(({ destination }) => destination)
}

/** Session history stays bounded and never retains messages or creates background work. */
export function rememberQuickDestination(recentIds: readonly string[], id: string): string[] {
  return [id, ...recentIds.filter((recentId) => recentId !== id)].slice(0, 30)
}

export function isQuickSwitcherShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "repeat" | "isComposing" | "defaultPrevented">, isMac: boolean): boolean {
  return !event.defaultPrevented && !event.repeat && !event.isComposing && !event.altKey && !event.shiftKey &&
    event.key.toLowerCase() === "k" && (isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)
}
