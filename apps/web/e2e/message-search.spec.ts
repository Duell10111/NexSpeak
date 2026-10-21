import { expect, test } from "@playwright/test"
import { createRoom, createSpace, login, matrixApi, messageRow, newPage, openRoom, registerUser, sendMessage, sendTextAs } from "./helpers"

test("server search groups results, filters content and opens old context in another channel", async ({ browser }, testInfo) => {
  const alice = await registerUser("search")
  const serverName = `Search ${Date.now().toString(36)}`
  const { channelIds } = await createSpace(alice, {
    name: serverName,
    channels: [{ name: "search-first" }, { name: "search-second" }],
  })
  const oldBody = "searchneedle archived https://example.org/guide"
  await sendTextAs(alice, channelIds[0], "searchneedle plain text")
  await sendTextAs(alice, channelIds[1], "Context before the archived message")
  await sendTextAs(alice, channelIds[1], oldBody)
  await sendTextAs(alice, channelIds[1], "Context after the archived message")
  for (let i = 0; i < 45; i++) await sendTextAs(alice, channelIds[1], `Recent filler ${i}`)

  const page = await newPage(browser)
  const searchRequests: string[] = []
  const contextRequests: string[] = []
  page.on("request", (request) => {
    if (request.url().includes("/search")) searchRequests.push(request.url())
    if (request.url().includes("/context/")) contextRequests.push(request.url())
  })
  await login(page, alice)
  await page.getByRole("navigation", { name: "Server-Liste" }).getByRole("button", { name: serverName }).click()
  await openRoom(page, "search-first")
  expect(searchRequests).toHaveLength(0)
  await page.getByRole("button", { name: "Nachrichten suchen", exact: true }).click()
  const search = page.getByRole("complementary", { name: "Nachrichten suchen" })
  await search.getByLabel("Suchtext").fill("searchneedle")
  await search.getByLabel("Suchen in").selectOption("server")
  await search.getByRole("button", { name: "Suchen", exact: true }).click()
  await expect(search.getByRole("button", { name: /Zur Nachricht springen/ })).toHaveCount(2)
  await expect(search.getByRole("heading", { name: "search-first", exact: true })).toBeVisible()
  await expect(search.getByRole("heading", { name: "search-second", exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("search-panel.png") })

  await search.getByLabel("Autor (Matrix-ID)").fill(alice.userId)
  await search.getByRole("combobox", { name: "Enthält", exact: true }).selectOption("link")
  await search.getByRole("button", { name: "Suchen", exact: true }).click()
  const result = search.getByRole("button", { name: /Zur Nachricht springen/ })
  await expect(result).toHaveCount(1)
  await expect(result).toContainText(oldBody)
  await result.click()
  await expect(page.getByRole("heading", { name: "search-second", exact: true, level: 3 })).toBeVisible()
  await expect(messageRow(page, oldBody)).toBeVisible()
  await expect(messageRow(page, "Context before the archived message")).toBeAttached()
  await expect(messageRow(page, "Context after the archived message")).toBeAttached()
  expect(contextRequests.length).toBeGreaterThan(0)
  await page.getByRole("button", { name: "Zurück zu den neuesten Nachrichten" }).click()
  await expect(messageRow(page, "Recent filler 44")).toBeVisible()

  await page.getByRole("button", { name: "Nachrichten suchen", exact: true }).click()
  await search.getByLabel("Suchtext").fill("searchneedle")
  await search.getByRole("button", { name: "Suchen", exact: true }).click()
  await search.getByRole("button", { name: /Zur Nachricht springen/ }).click()
  await expect(messageRow(page, oldBody)).toBeVisible()
  await sendMessage(page, "Sent while viewing history")
  await expect(messageRow(page, "Sent while viewing history")).toBeVisible()
  await expect(page.getByRole("button", { name: "Zurück zu den neuesten Nachrichten" })).toHaveCount(0)
})

test("search opens an unloaded thread reply with its root", async ({ browser }) => {
  const alice = await registerUser("searchthread")
  const roomName = `Thread search ${Date.now().toString(36)}`
  const roomId = await createRoom(alice, { name: roomName, members: [] })
  const path = `/rooms/${encodeURIComponent(roomId)}/send/m.room.message`
  const { event_id: rootId } = await matrixApi<{ event_id: string }>(alice, "PUT", `${path}/root`, {
    msgtype: "m.text", body: "Archived thread topic",
  })
  await matrixApi(alice, "PUT", `${path}/reply`, {
    msgtype: "m.text", body: "threadneedle archived reply",
    "m.relates_to": { rel_type: "m.thread", event_id: rootId, is_falling_back: true, "m.in_reply_to": { event_id: rootId } },
  })
  for (let i = 0; i < 25; i++) await sendTextAs(alice, roomId, `New thread filler ${i}`)
  const page = await newPage(browser)
  await login(page, alice)
  await openRoom(page, roomName)
  await page.getByRole("button", { name: "Nachrichten suchen", exact: true }).click()
  const search = page.getByRole("complementary", { name: "Nachrichten suchen" })
  await search.getByLabel("Suchtext").fill("threadneedle")
  await search.getByRole("button", { name: "Suchen", exact: true }).click()
  await search.getByRole("button", { name: /Zur Nachricht springen/ }).click()
  await expect(messageRow(page, "threadneedle archived reply")).toBeVisible()
  await expect(messageRow(page, "Archived thread topic")).toBeAttached()
  await page.getByRole("button", { name: "Zurück zu den neuesten Nachrichten" }).click()
  await expect(messageRow(page, "New thread filler 24")).toBeVisible()
})

test("encrypted DM search explains the limitation without transmitting a search", async ({ browser }) => {
  const alice = await registerUser("searchencrypted")
  const bob = await registerUser("searchpeer")
  const roomId = await createRoom(alice, { name: "Encrypted search", members: [bob], encrypted: true })
  await matrixApi(alice, "PUT", `/user/${encodeURIComponent(alice.userId)}/account_data/m.direct`, { [bob.userId]: [roomId] })
  const page = await newPage(browser)
  let requests = 0
  page.on("request", (request) => { if (request.url().includes("/search")) requests++ })
  await login(page, alice)
  await openRoom(page, "Encrypted search")
  await page.getByRole("button", { name: "Nachrichten suchen", exact: true }).click()
  const search = page.getByRole("complementary", { name: "Nachrichten suchen" })
  await expect(search.getByText(/Die Suche umfasst nur unverschlüsselte Räume/)).toBeVisible()
  await search.getByLabel("Suchtext").fill("private words")
  await search.getByRole("button", { name: "Suchen", exact: true }).click()
  await expect(search.getByText("Keine passenden Nachrichten auf dieser Seite.")).toBeVisible()
  expect(requests).toBe(0)
})
