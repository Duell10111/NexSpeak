import { describe, expect, it, vi } from "vitest"
import { MatrixEvent, type MatrixClient, type Room } from "matrix-js-sdk"
import { clearStoredPresence, setOwnPresence } from "./profile"
import { notificationFor } from "./notifications"

const OWN = "@me:example.org"
const ROOM_ID = "!room:example.org"

function event(content: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return new MatrixEvent({
    type: "m.room.message",
    room_id: ROOM_ID,
    sender: "@alice:example.org",
    event_id: "$event",
    origin_server_ts: Date.now(),
    content,
    ...extra,
  })
}

function client(
  actions: { notify: boolean; tweaks?: { highlight?: boolean } } | null,
  directRooms: string[] = [],
  ignored: string[] = [],
) {
  return {
    getUserId: () => OWN,
    isUserIgnored: (userId: string) => ignored.includes(userId),
    getPushActionsForEvent: () => actions,
    getAccountData: () => ({ getContent: () => ({ "@alice:example.org": directRooms }) }),
  } as unknown as MatrixClient
}

const room = { roomId: ROOM_ID, name: "Allgemein", isSpaceRoom: () => false, getDMInviter: () => undefined } as unknown as Room

describe("notificationFor", () => {
  it("never notifies about ignored people", () => {
    const message = event({ msgtype: "m.text", body: "Hallo" })
    expect(notificationFor(client({ notify: true }, [], ["@alice:example.org"]), message, room)).toBeNull()
  })

  it("follows the push rules", () => {
    const message = event({ msgtype: "m.text", body: "Hallo" })
    expect(notificationFor(client({ notify: false }), message, room)).toBeNull()
    expect(notificationFor(client(null), message, room)).toBeNull()
    expect(notificationFor(client({ notify: true }), message, room)).toMatchObject({
      roomId: ROOM_ID,
      roomName: "Allgemein",
      body: "Hallo",
      isDirect: false,
      isHighlight: false,
    })
    expect(notificationFor(client({ notify: true, tweaks: { highlight: true } }), message, room)?.isHighlight).toBe(true)
  })

  it("marks direct messages", () => {
    const message = event({ msgtype: "m.text", body: "Hi" })
    expect(notificationFor(client({ notify: true }, [ROOM_ID]), message, room)?.isDirect).toBe(true)
  })

  it("ignores own messages, edits, old catch-up and other event types", () => {
    const notify = client({ notify: true })
    expect(notificationFor(notify, event({ body: "x" }, { sender: OWN }), room)).toBeNull()
    const edit = event({ body: "* x", "m.relates_to": { rel_type: "m.replace", event_id: "$old" } })
    expect(notificationFor(notify, edit, room)).toBeNull()
    expect(notificationFor(notify, event({ body: "x" }, { origin_server_ts: Date.now() - 10 * 60_000 }), room)).toBeNull()
    expect(notificationFor(notify, event({}, { type: "m.reaction" }), room)).toBeNull()
  })

  it("summarizes attachments", () => {
    const image = event({ msgtype: "m.image", body: "IMG_1.jpg" })
    expect(notificationFor(client({ notify: true }), image, room)?.body).not.toBe("IMG_1.jpg")
  })
})

it("silences DND alerts without changing Matrix push rules or unread counts", async () => {
  const storage = new Map<string, string>()
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) })
  const own = { setSyncPresence: vi.fn(async () => {}), setPresence: vi.fn(async () => {}), getUserId: () => OWN } as unknown as MatrixClient
  const notify = client({ notify: true, tweaks: { highlight: true } })
  const message = event({ body: "Mention" })
  try {
    await setOwnPresence(own, "dnd")
    expect(notificationFor(notify, message, room)).toBeNull()
    expect(notify.getPushActionsForEvent(message, true)).toEqual({ notify: true, tweaks: { highlight: true } })
    await setOwnPresence(own, "online")
    expect(notificationFor(notify, message, room)?.isHighlight).toBe(true)
  } finally {
    clearStoredPresence()
    vi.unstubAllGlobals()
  }
})
