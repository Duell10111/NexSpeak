import { describe, expect, it } from "vitest"
import type { RoomDirectory } from "@/hooks/useRoomDirectory"
import type { MatrixRoom } from "@nexspeak/core/matrix/types"
import { isQuickSwitcherShortcut, quickDestinations, rememberQuickDestination, searchQuickDestinations } from "./quick-switcher"

function room(id: string, name: string, unread = 0, highlights = 0): MatrixRoom {
  return { id, name, unread, highlights, memberCount: 2, lastActivityTs: 0, membership: "join" }
}

const shared = room("shared", "General", 4, 2)
const directory: RoomDirectory = {
  spaces: [
    { id: "alpha", name: "Alpha Gaming", unread: 4, mentions: 2, childRoomIds: ["shared"] },
    { id: "beta", name: "Beta", unread: 0, mentions: 0, childRoomIds: ["shared", "ops"] },
  ],
  roomsBySpace: { alpha: [shared], beta: [shared, room("ops", "Operations")] },
  sectionsBySpace: {}, structureKeyBySpace: {},
  directRooms: [room("friend", "Élodie", 3, 1)],
  otherRooms: [room("standalone", "Archive"), { ...room("left", "Left"), membership: "leave" }],
  invites: [{ ...room("invite", "Invitation"), membership: "invite" }],
  friends: [],
}

describe("quick switcher directory search", () => {
  it("lists joined destinations once and retains server context, unread and mention counts", () => {
    const entries = quickDestinations(directory)
    expect(entries.map(({ id }) => id)).toEqual(["alpha", "shared", "beta", "ops", "friend", "standalone"])
    expect(entries.find(({ id }) => id === "shared")).toMatchObject({ serverId: "alpha", serverName: "Alpha Gaming", unread: 4, mentions: 2 })
    expect(entries.find(({ id }) => id === "friend")).toMatchObject({ kind: "direct", unread: 3, mentions: 1 })
  })

  it("matches abbreviated and accent-insensitive names and server plus channel queries", () => {
    const entries = quickDestinations(directory)
    expect(searchQuickDestinations(entries, "optn", []).map(({ id }) => id)).toEqual(["ops"])
    expect(searchQuickDestinations(entries, " ELODIE ", []).map(({ id }) => id)).toEqual(["friend"])
    expect(searchQuickDestinations(entries, "alpha gen", []).map(({ id }) => id)).toEqual(["shared"])
    expect(searchQuickDestinations(entries, "missing", [])).toEqual([])
  })

  it("prefers names over loose matches and puts recent existing destinations first for an empty query", () => {
    const entries = quickDestinations(directory)
    expect(searchQuickDestinations(entries, "", ["gone", "friend", "ops"]).slice(0, 2).map(({ id }) => id)).toEqual(["friend", "ops"])
    expect(searchQuickDestinations([
      { ...entries[0], id: "loose", name: "Orange Planet" },
      { ...entries[0], id: "substring", name: "Guild Operations" },
      { ...entries[0], id: "prefix", name: "Operations" },
      { ...entries[0], id: "exact", name: "Op" },
    ], "op", ["loose"]).map(({ id }) => id)).toEqual(["exact", "prefix", "substring", "loose"])
  })

  it("deduplicates and bounds session history", () => {
    const history = Array.from({ length: 30 }, (_, index) => String(index))
    expect(rememberQuickDestination(history, "5").slice(0, 3)).toEqual(["5", "0", "1"])
    expect(rememberQuickDestination(history, "new")).toHaveLength(30)
    expect(rememberQuickDestination(history, "new")).not.toContain("29")
  })
})

describe("local quick switcher shortcut", () => {
  const event = { key: "k", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, defaultPrevented: false }

  it("uses Ctrl on Windows/Linux and Cmd on macOS", () => {
    expect(isQuickSwitcherShortcut(event, false)).toBe(true)
    expect(isQuickSwitcherShortcut(event, true)).toBe(false)
    expect(isQuickSwitcherShortcut({ ...event, ctrlKey: false, metaKey: true }, true)).toBe(true)
  })

  it("leaves captured shortcuts, modified combinations, composition and repeats alone", () => {
    for (const overrides of [{ defaultPrevented: true }, { repeat: true }, { isComposing: true }, { altKey: true }, { shiftKey: true }, { metaKey: true }, { key: "m" }]) {
      expect(isQuickSwitcherShortcut({ ...event, ...overrides }, false)).toBe(false)
    }
  })
})
