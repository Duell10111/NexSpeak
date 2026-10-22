import { describe, expect, it, vi } from "vitest"
import { EventStatus, MatrixError, MatrixEvent, type MatrixClient } from "matrix-js-sdk"
import { editTextMessage, hideLinkPreview, sendGif, sendTextMessage, sendSticker } from "./messages"

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

  it('removes only the failed local edit so retrying does not get blocked behind it', async () => {
    const error = new MatrixError({ errcode: 'M_FORBIDDEN', error: 'Rejected edit' }, 403)
    const original = new MatrixEvent({ event_id: '$orig', type: 'm.room.message', content: { msgtype: 'm.text', body: 'Original' } })
    const pending = (id: string) => {
      const event = new MatrixEvent({ type: 'm.room.message', content: { 'm.relates_to': { rel_type: 'm.replace', event_id: id } } })
      event.status = EventStatus.NOT_SENT
      event.error = error
      return event
    }
    const unrelated = pending('$other')
    const failed = pending('$orig')
    const client = { ...fakeClient(), getRoom: () => ({ getPendingEvents: () => [unrelated, failed] }), cancelPendingEvent: vi.fn() }
    client.sendMessage.mockRejectedValue(error)
    await expect(editTextMessage(client as unknown as MatrixClient, '!r', original, 'Keep this draft')).rejects.toBe(error)
    expect(client.cancelPendingEvent).toHaveBeenCalledExactlyOnceWith(failed)
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

describe('sender link preview suppression', () => {
  it('includes the sender preference in the original message content', async () => {
    const client = fakeClient()
    await sendTextMessage(client as unknown as MatrixClient, '!r', 'https://example.org', { hideLinkPreviews: true })
    expect(client.sendMessage.mock.calls[0][1]).toMatchObject({ 'org.nexspeak.hide_link_previews': true })
  })
  it('preserves sender suppression through later edits', async () => {
    const client = fakeClient()
    const original = new MatrixEvent({ event_id: '$original', content: { msgtype: 'm.text', body: 'https://old.example', 'org.nexspeak.hide_link_previews': true } })
    await editTextMessage(client as unknown as MatrixClient, '!r', original, 'https://new.example')
    expect(client.sendMessage.mock.calls[0][1]['m.new_content']).toMatchObject({ body: 'https://new.example', 'org.nexspeak.hide_link_previews': true })
  })
  it('hides without changing rich notice content, thread/reply relations or notification intent', async () => {
    const client = fakeClient()
    const originalContent = { msgtype: 'm.notice', body: 'https://example.org label', format: 'org.matrix.custom.html', formatted_body: '<strong><a href="https://example.org">label</a></strong>', 'm.mentions': { user_ids: ['@alice:example.org'] }, 'm.relates_to': { rel_type: 'm.thread', event_id: '$root', 'm.in_reply_to': { event_id: '$reply' } } }
    const original = new MatrixEvent({ event_id: '$original', content: originalContent })
    await hideLinkPreview(client as unknown as MatrixClient, '!r', original)
    expect(client.sendMessage.mock.calls[0][1]).toMatchObject({
      msgtype: 'm.notice', 'm.mentions': {}, 'm.relates_to': { rel_type: 'm.replace', event_id: '$original' },
      'm.new_content': { ...originalContent, 'org.nexspeak.hide_link_previews': true },
    })
  })
})

describe('sendGif', () => {
  function uploadingClient() {
    let count = 0
    return {
      ...fakeClient(),
      uploadContent: vi.fn().mockImplementation(async () => ({ content_uri: `mxc://hs/${++count}` })),
    }
  }
  const gif = {
    title: 'Happy: dance',
    data: new Blob([new Uint8Array([1, 2, 3])], { type: 'video/mp4' }),
    mimetype: 'video/mp4',
    width: 320,
    height: 240,
    durationMs: 1500.4,
    thumbnail: { data: new Blob([new Uint8Array([4])], { type: 'image/jpeg' }), mimetype: 'image/jpeg', width: 320, height: 240 },
  }

  it('sends a looping, silent video with a thumbnail', async () => {
    const client = uploadingClient()
    await sendGif(client as unknown as MatrixClient, '!r', gif, false)
    expect(client.uploadContent).toHaveBeenCalledWith(gif.data, { name: 'Happy dance.mp4', type: 'video/mp4' })
    expect(client.sendMessage).toHaveBeenCalledWith('!r', {
      msgtype: 'm.video',
      body: 'Happy: dance',
      filename: 'Happy dance.mp4',
      url: 'mxc://hs/1',
      info: {
        mimetype: 'video/mp4', size: 3, w: 320, h: 240, duration: 1500,
        thumbnail_url: 'mxc://hs/2',
        thumbnail_info: { mimetype: 'image/jpeg', size: 1, w: 320, h: 240 },
        'fi.mau.gif': true, 'fi.mau.loop': true, 'fi.mau.autoplay': true, 'fi.mau.hide_controls': true, 'fi.mau.no_audio': true,
      },
      'm.mentions': {},
    })
  })

  it('encrypts the video and its thumbnail in encrypted rooms', async () => {
    const client = uploadingClient()
    await sendGif(client as unknown as MatrixClient, '!r', gif, true, { threadRootId: '$root', threadLatestEventId: '$last' })
    const content = client.sendMessage.mock.calls[0][1]
    expect(content.url).toBeUndefined()
    expect(content.file).toMatchObject({ url: 'mxc://hs/1', v: 'v2' })
    expect(content.info.thumbnail_file).toMatchObject({ url: 'mxc://hs/2', v: 'v2' })
    expect(content.info.thumbnail_url).toBeUndefined()
    expect(content['m.relates_to']).toMatchObject({ rel_type: 'm.thread', event_id: '$root' })
    for (const [blob, options] of client.uploadContent.mock.calls) {
      expect(options).toEqual({ type: 'application/octet-stream', includeFilename: false })
      expect(blob.type).toBe('')
    }
  })

  it('falls back to m.image for real GIF files', async () => {
    const client = uploadingClient()
    const data = new Blob([new Uint8Array([1])], { type: 'image/gif' })
    await sendGif(client as unknown as MatrixClient, '!r', { title: '', data, mimetype: 'image/gif', width: 0, height: 0 }, false)
    expect(client.sendMessage.mock.calls[0][1]).toMatchObject({ msgtype: 'm.image', body: 'GIF', filename: 'GIF.gif', info: { mimetype: 'image/gif', size: 1 } })
    expect(client.sendMessage.mock.calls[0][1].info['fi.mau.gif']).toBeUndefined()
  })
})
