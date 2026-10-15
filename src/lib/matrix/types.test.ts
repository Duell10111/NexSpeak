import { describe, expect, it } from "vitest"
import { MatrixEvent } from "matrix-js-sdk"
import { eventToMatrixMessage, stripReplyFallback } from "./types"

const ROOM = "!room:example.org"

function messageEvent(content: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return new MatrixEvent({
    type: "m.room.message",
    room_id: ROOM,
    sender: "@alice:example.org",
    event_id: "$event1",
    origin_server_ts: 1_700_000_000_000,
    content,
    ...extra,
  })
}

describe("eventToMatrixMessage", () => {
  it("maps a plain text message", () => {
    const message = eventToMatrixMessage(messageEvent({ msgtype: "m.text", body: "Hallo" }), ROOM)
    expect(message).toMatchObject({
      id: "$event1",
      kind: "text",
      body: "Hallo",
      senderId: "@alice:example.org",
      status: "sent",
      edited: false,
      reactions: [],
    })
  })

  it("hides edit events, the SDK folds them into the original", () => {
    const edit = messageEvent({
      msgtype: "m.text",
      body: "* neu",
      "m.new_content": { msgtype: "m.text", body: "neu" },
      "m.relates_to": { rel_type: "m.replace", event_id: "$original" },
    })
    expect(eventToMatrixMessage(edit, ROOM)).toBeNull()
  })

  it("ignores non-message events", () => {
    const state = new MatrixEvent({ type: "m.room.name", room_id: ROOM, state_key: "", content: { name: "x" } })
    expect(eventToMatrixMessage(state, ROOM)).toBeNull()
  })

  it("marks redacted messages", () => {
    const event = messageEvent({}, { unsigned: { redacted_because: { type: "m.room.redaction" } } })
    expect(eventToMatrixMessage(event, ROOM)).toMatchObject({ kind: "redacted", body: "Nachricht gelöscht" })
  })

  it("strips reply fallbacks and exposes the replied-to event id", () => {
    const event = messageEvent({
      msgtype: "m.text",
      body: "> <@bob:example.org> Wie geht's?\n> zweite Zeile\n\nGut, danke!",
      "m.relates_to": { "m.in_reply_to": { event_id: "$parent" } },
    })
    const message = eventToMatrixMessage(event, ROOM)
    expect(message?.body).toBe("Gut, danke!")
    expect(message?.replyTo?.eventId).toBe("$parent")
  })

  it("maps encrypted attachments with their decryption info", () => {
    const file = {
      url: "mxc://example.org/abc",
      iv: "AAAAAAAAAAAAAAAAAAAAAA",
      key: { alg: "A256CTR", ext: true, k: "k", key_ops: ["encrypt", "decrypt"], kty: "oct" },
      hashes: { sha256: "hash" },
      v: "v2",
    }
    const message = eventToMatrixMessage(
      messageEvent({ msgtype: "m.image", body: "foto.png", file, info: { mimetype: "image/png", w: 10, h: 20 } }),
      ROOM,
    )
    expect(message).toMatchObject({ kind: "image", body: "foto.png" })
    expect(message?.media).toMatchObject({ file, mimetype: "image/png", width: 10, height: 20 })
    expect(message?.media?.mxc).toBeUndefined()
  })

  it("keeps unknown message types readable when they have a body", () => {
    const message = eventToMatrixMessage(messageEvent({ msgtype: "org.example.custom", body: "Fallback" }), ROOM)
    expect(message).toMatchObject({ kind: "unsupported", body: "Fallback" })
  })
})

describe("stripReplyFallback", () => {
  it("leaves normal text alone", () => {
    expect(stripReplyFallback("Hallo\n> kein Zitat am Anfang")).toBe("Hallo\n> kein Zitat am Anfang")
  })
})
