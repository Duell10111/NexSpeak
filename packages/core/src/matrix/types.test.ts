import { describe, expect, it, vi } from "vitest"
import { MatrixEvent, type Room, type Thread } from "matrix-js-sdk"
import { eventToMatrixMessage, stripReplyFallback, summarizeEvent, threadSummary } from "./types"

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

  it('hides a loaded reply quotation when its author is ignored and restores it after unignoring', () => {
    const parent = messageEvent({ msgtype: 'm.text', body: 'Hidden quotation' })
    const reply = messageEvent({ msgtype: 'm.text', body: 'Visible reply', 'm.relates_to': { 'm.in_reply_to': { event_id: '$event1' } } }, { sender: '@bob:example.org', event_id: '$reply' })
    const ignored = vi.fn().mockReturnValue(true)
    const room = { client: { isUserIgnored: ignored }, findEventById: () => parent,
      relations: { getChildEventsForEvent: () => undefined } } as unknown as Room
    expect(eventToMatrixMessage(reply, ROOM, { room })).toMatchObject({ body: 'Visible reply', replyTo: undefined })
    ignored.mockReturnValue(false)
    expect(eventToMatrixMessage(reply, ROOM, { room })?.replyTo?.body).toBe('Hidden quotation')
  })

  it('keeps thread reply counts while hiding an ignored latest reply', () => {
    const root = messageEvent({ msgtype: 'm.text', body: 'Visible root' })
    const latest = messageEvent({ msgtype: 'm.text', body: 'Hidden thread reply' })
    root.setThread({ id: root.getId(), rootEvent: root, replyToEvent: latest, length: 1,
      hasCurrentUserParticipated: false, on: vi.fn() } as unknown as Thread)
    const ignored = vi.fn().mockReturnValue(true)
    const room = { client: { isUserIgnored: ignored }, relations: { getChildEventsForEvent: () => undefined } } as unknown as Room
    expect(eventToMatrixMessage(root, ROOM, { room })?.thread).toMatchObject({ count: 1, latestBody: '', latestSenderName: '' })
    ignored.mockReturnValue(false)
    expect(eventToMatrixMessage(root, ROOM, { room })?.thread?.latestBody).toBe('Hidden thread reply')
    expect(threadSummary(root)?.count).toBe(1)
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

  it('preserves separate video previews and rejects non-Matrix preview URLs', () => {
    const event = (info: Record<string, unknown>) => messageEvent({ msgtype: 'm.video', body: 'clip.mp4', url: 'mxc://test/video', info })
    expect(eventToMatrixMessage(event({ thumbnail_url: 'mxc://test/preview', thumbnail_info: { mimetype: 'image/jpeg' } }), ROOM)?.media?.thumbnail)
      .toEqual({ mxc: 'mxc://test/preview', file: undefined, mimetype: 'image/jpeg' })
    expect(eventToMatrixMessage(event({ thumbnail_url: 'https://tracker.test/pixel' }), ROOM)?.media?.thumbnail).toBeUndefined()
    expect(eventToMatrixMessage(event({ thumbnail_url: 'mxc://test/video' }), ROOM)?.media?.thumbnail).toBeUndefined()
    const file = { url: 'mxc://test/encrypted-preview', iv: 'iv', key: { k: 'key' }, hashes: { sha256: 'hash' } }
    expect(eventToMatrixMessage(event({ thumbnail_file: file }), ROOM)?.media?.thumbnail?.file).toEqual(file)
  })

  it('marks GIF videos (own and mautrix flags) and image/gif files, and keeps their title', () => {
    const video = (info: Record<string, unknown>) =>
      eventToMatrixMessage(messageEvent({ msgtype: 'm.video', body: 'Party', filename: 'Party.mp4', url: 'mxc://test/gif', info }), ROOM)
    expect(video({ mimetype: 'video/mp4', 'fi.mau.gif': true })).toMatchObject({ kind: 'video', body: 'Party', media: { gif: true } })
    expect(video({ 'fi.mau.loop': true, 'fi.mau.autoplay': true })?.media?.gif).toBe(true)
    const plain = video({ 'fi.mau.loop': true })
    expect(plain?.body).toBe('Party.mp4')
    expect(plain?.media?.gif).toBeUndefined()
    const image = (mimetype: string) => eventToMatrixMessage(messageEvent({ msgtype: 'm.image', body: 'a', url: 'mxc://test/a', info: { mimetype } }), ROOM)
    expect(image('image/gif')?.media?.gif).toBe(true)
    expect(image('image/png')?.media?.gif).toBeUndefined()
  })
})

describe("stripReplyFallback", () => {
  it("leaves normal text alone", () => {
    expect(stripReplyFallback("Hallo\n> kein Zitat am Anfang")).toBe("Hallo\n> kein Zitat am Anfang")
  })
})


describe('sticker timeline events', () => {
  it('maps external-client stickers without a msgtype and retains reply relations', () => {
    const event = messageEvent({ body: 'Happy cat', url: 'mxc://test/cat', info: { w: 256, h: 128, mimetype: 'image/png' },
      'm.relates_to': { 'm.in_reply_to': { event_id: '$parent' } },
    }, { type: 'm.sticker' })
    expect(eventToMatrixMessage(event, ROOM)).toMatchObject({ kind: 'sticker', body: 'Happy cat',
      media: { mxc: 'mxc://test/cat', width: 256, height: 128 }, replyTo: { eventId: '$parent' },
    })
  })
  it('keeps redacted stickers redacted and malformed media as safe text fallbacks', () => {
    const event = messageEvent({}, { type: 'm.sticker', unsigned: { redacted_because: { type: 'm.room.redaction' } } })
    expect(eventToMatrixMessage(event, ROOM)?.kind).toBe('redacted')
    const unsafe = eventToMatrixMessage(messageEvent({ body: 'Fallback', url: 'https://tracker/pixel', info: { w: -50, h: Infinity } }, { type: 'm.sticker' }), ROOM)
    expect(unsafe).toMatchObject({ kind: 'sticker', body: 'Fallback', media: { mxc: undefined, width: undefined, height: undefined } })
  })
})

describe('summarizeEvent', () => {
  it('summarizes GIFs as GIF', () => {
    expect(summarizeEvent(messageEvent({ msgtype: 'm.video', body: 'Party', info: { 'fi.mau.gif': true } }))).toBe('GIF')
    expect(summarizeEvent(messageEvent({ msgtype: 'm.image', body: 'x.gif', info: { mimetype: 'image/gif' } }))).toBe('GIF')
  })
})
