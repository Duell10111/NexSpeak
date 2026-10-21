import { describe, expect, it, vi } from "vitest"
import { MatrixEvent, type MatrixClient } from "matrix-js-sdk"
import { editTextMessage, sendTextMessage, sendSticker } from "./messages"

function fakeClient() {
  return { getUserId: () => "@me:example.org", sendMessage: vi.fn().mockResolvedValue({ event_id: "$new" }) }
}

const ALICE = { text: "@Alice", href: "https://matrix.to/#/@alice:example.org", userId: "@alice:example.org" }

describe("sendTextMessage", () => {
  it("sends plain text without HTML", async () => {
    const client = fakeClient()
    await sendTextMessage(client as unknown as MatrixClient, "!r", "hello")
    expect(client.sendMessage).toHaveBeenCalledWith("!r", { msgtype: "m.text", body: "hello", "m.mentions": {} })
  })

  it("sends markdown as formatted body and notifies mentioned people", async () => {
    const client = fakeClient()
    await sendTextMessage(client as unknown as MatrixClient, "!r", "**hi** @Alice", { mentions: [ALICE] })
    expect(client.sendMessage).toHaveBeenCalledWith("!r", {
      msgtype: "m.text",
      body: "**hi** @Alice",
      format: "org.matrix.custom.html",
      formatted_body: '<strong>hi</strong> <a href="https://matrix.to/#/@alice:example.org">@Alice</a>',
      "m.mentions": { user_ids: ["@alice:example.org"] },
    })
  })

  it("puts messages into threads with a reply fallback", async () => {
    const client = fakeClient()
    await sendTextMessage(client as unknown as MatrixClient, "!r", "in thread", { threadRootId: "$root", threadLatestEventId: "$last" })
    expect(client.sendMessage.mock.calls[0][1]["m.relates_to"]).toEqual({
      rel_type: "m.thread",
      event_id: "$root",
      is_falling_back: true,
      "m.in_reply_to": { event_id: "$last" },
    })
  })
})

describe("editTextMessage", () => {
  it("keeps mention pills of the original", async () => {
    const client = fakeClient()
    const original = new MatrixEvent({ event_id: "$orig", type: "m.room.message", content: { msgtype: "m.text", body: "hi @Alice" } })
    await editTextMessage(client as unknown as MatrixClient, "!r", original, "hey @Alice", [ALICE])
    const content = client.sendMessage.mock.calls[0][1]
    expect(content["m.new_content"]).toMatchObject({
      formatted_body: 'hey <a href="https://matrix.to/#/@alice:example.org">@Alice</a>',
      "m.mentions": { user_ids: ["@alice:example.org"] },
    })
    expect(content["m.mentions"]).toEqual({})
    expect(content["m.relates_to"]).toEqual({ rel_type: "m.replace", event_id: "$orig" })
  })
})

describe('custom emoji messages', () => {
  it('sends interoperable custom emoji inside markdown but keeps code and URLs literal', async () => {
    const client = fakeClient()
    await sendTextMessage(client as unknown as MatrixClient, '!r', '**:cat:** `:cat:` https://test/:cat:', { customEmojis: [{ text: ':cat:', url: 'mxc://test/cat' }] })
    expect(client.sendMessage.mock.calls[0][1]).toMatchObject({
      body: '**:cat:** `:cat:` https://test/:cat:',
      formatted_body: '<strong><img data-mx-emoticon src="mxc://test/cat" alt=":cat:" title=":cat:" height="32"></strong> <code>:cat:</code> https://test/:cat:',
    })
  })

  it('retains emoji when editing and escapes their fallback', async () => {
    const client = fakeClient()
    const original = new MatrixEvent({ event_id: '$orig', type: 'm.room.message', content: {
      msgtype: 'm.text', body: ':cat:', format: 'org.matrix.custom.html',
      formatted_body: '<img data-mx-emoticon src="mxc://test/cat" alt=":cat:">',
    } })
    await editTextMessage(client as unknown as MatrixClient, '!r', original, 'hello :cat:')
    expect(client.sendMessage.mock.calls[0][1]['m.new_content'].formatted_body).toContain('<img data-mx-emoticon src="mxc://test/cat"')
  })
})


describe('sendSticker', () => {
  const sticker = { name: 'cat', body: 'Happy cat', url: 'mxc://test/cat', key: 'mxc://test/cat', packId: '', packName: 'Cats', info: { w: 256, h: 256, mimetype: 'image/png' } }
  it('sends m.sticker with metadata and intentional reply mentions', async () => {
    const client = { getUserId: () => '@me:example.org', sendEvent: vi.fn().mockResolvedValue({}) }
    const replyTo = new MatrixEvent({ event_id: '$reply', sender: '@alice:example.org' })
    await sendSticker(client as unknown as MatrixClient, '!r', sticker, { replyTo })
    expect(client.sendEvent).toHaveBeenCalledWith('!r', 'm.sticker', {
      body: 'Happy cat', url: sticker.url, info: sticker.info,
      'm.relates_to': { 'm.in_reply_to': { event_id: '$reply' } },
      'm.mentions': { user_ids: ['@alice:example.org'] },
    })
  })
  it('keeps thread relations and rejects external URLs before sending', async () => {
    const client = { getUserId: () => '@me:example.org', sendEvent: vi.fn().mockResolvedValue({}) }
    await sendSticker(client as unknown as MatrixClient, '!r', sticker, { threadRootId: '$root', threadLatestEventId: '$last' })
    expect(client.sendEvent.mock.calls[0][2]['m.relates_to']).toEqual({
      rel_type: 'm.thread', event_id: '$root', is_falling_back: true, 'm.in_reply_to': { event_id: '$last' },
    })
    await expect(sendSticker(client as unknown as MatrixClient, '!r', { ...sticker, url: 'https://tracker/pixel' })).rejects.toThrow('Invalid sticker')
    expect(client.sendEvent).toHaveBeenCalledTimes(1)
  })
})
