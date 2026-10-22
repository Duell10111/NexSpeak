import { expect, test } from "@playwright/test"
import { createRoom, getRoomMessages, login, matrixApi, messageRow, newPage, openRoom, registerUser, sendMessage } from "./helpers"

test("markdown, mentions with autocompletion and the mention highlight", async ({ browser }) => {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")
  const roomName = `Markdown ${Date.now().toString(36)}`
  const roomId = await createRoom(alice, { name: roomName, members: [bob] })

  const alicePage = await newPage(browser)
  const bobPage = await newPage(browser)
  await login(alicePage, alice)
  await login(bobPage, bob)
  await openRoom(alicePage, roomName)
  await openRoom(bobPage, roomName)

  const composer = alicePage.getByRole("textbox", { name: "Nachricht", exact: true })
  await composer.click()
  await composer.pressSequentially("**fett** und ~~weg~~ für @bo", { delay: 20 })
  await alicePage.getByRole("option", { name: new RegExp(bob.username) }).click()
  await composer.pressSequentially("`<b>code</b>`", { delay: 10 })
  await composer.press("Enter")

  const row = messageRow(bobPage, "fett")
  await expect(row.locator("strong", { hasText: "fett" })).toBeVisible()
  await expect(row.locator("del", { hasText: "weg" })).toBeVisible()
  // HTML in code stays text.
  await expect(row.locator("code", { hasText: "<b>code</b>" })).toBeVisible()
  // The pill points to Bob, and Bob sees the message highlighted as a mention.
  await expect(row.getByRole("link", { name: `@${bob.username}` })).toHaveAttribute("href", `https://matrix.to/#/${encodeURIComponent(bob.userId)}`)
  await expect(row).toHaveClass(/border-nx-idle/)

  const sent = (await getRoomMessages(alice, roomId)).find((event) => event.type === "m.room.message")
  expect(sent?.content).toMatchObject({
    format: "org.matrix.custom.html",
    "m.mentions": { user_ids: [bob.userId] },
  })
  expect(String(sent?.content.formatted_body)).toContain("<strong>fett</strong>")
})

test("threads: start one from a message, reply, and follow it from the other side", async ({ browser }) => {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")
  const roomName = `Threads ${Date.now().toString(36)}`
  await createRoom(alice, { name: roomName, members: [bob] })

  const alicePage = await newPage(browser)
  const bobPage = await newPage(browser)
  await login(alicePage, alice)
  await login(bobPage, bob)
  await openRoom(alicePage, roomName)
  await openRoom(bobPage, roomName)

  await sendMessage(alicePage, "Worüber reden wir?")
  await messageRow(alicePage, "Worüber reden wir?").hover()
  await alicePage.getByRole("button", { name: "Thread erstellen" }).click()
  const threadPanel = alicePage.getByRole("complementary", { name: "Thread" })
  const threadComposer = threadPanel.getByRole("textbox", { name: "Nachricht", exact: true })
  await threadComposer.fill("Über Threads!")
  await threadComposer.press("Enter")
  await expect(threadPanel.getByText("Über Threads!")).toBeVisible()
  // Still there after the server's echo (the first reply of a new thread used to vanish), and
  // counted under the root.
  await expect(alicePage.getByRole("button", { name: "Thread öffnen: 1 Antwort" })).toContainText("1 Antwort")
  await expect(threadPanel.getByText("Über Threads!")).toBeVisible()

  // Bob sees a summary under the root, not the reply in the channel.
  const summary = messageRow(bobPage, "Worüber reden wir?").getByRole("button", { name: "Thread öffnen: 1 Antwort" })
  await expect(summary).toBeVisible()
  await expect(bobPage.getByRole("log").first().getByText("Über Threads!", { exact: true })).toHaveCount(0)
  await summary.click()
  const bobThread = bobPage.getByRole("complementary", { name: "Thread" })
  await expect(bobThread.getByText("Über Threads!")).toBeVisible()
  const bobComposer = bobThread.getByRole("textbox", { name: "Nachricht", exact: true })
  await bobComposer.fill("Gute Idee")
  await bobComposer.press("Enter")
  await expect(threadPanel.getByText("Gute Idee")).toBeVisible()

  // The thread list of the channel.
  await bobPage.getByRole("button", { name: "Zurück zur Thread-Liste" }).click()
  await expect(bobPage.getByRole("complementary", { name: "Threads" }).getByText("2 Antworten")).toBeVisible()
})

test("pin messages, report one and ignore its sender", async ({ browser }) => {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")
  const roomName = `Pins ${Date.now().toString(36)}`
  const roomId = await createRoom(alice, { name: roomName, members: [bob] })

  const alicePage = await newPage(browser)
  const bobPage = await newPage(browser)
  await login(alicePage, alice)
  await login(bobPage, bob)
  await openRoom(alicePage, roomName)
  await openRoom(bobPage, roomName)

  await sendMessage(alicePage, "Wichtige Regeln")
  await messageRow(alicePage, "Wichtige Regeln").hover()
  await alicePage.getByRole("button", { name: "Mehr" }).click()
  await alicePage.getByRole("menuitem", { name: "Anheften" }).click()

  await bobPage.getByRole("button", { name: "Angeheftete Nachrichten" }).click()
  await expect(bobPage.getByRole("dialog").getByText("Wichtige Regeln")).toBeVisible()
  await bobPage.keyboard.press("Escape")
  const pins = await matrixApi<{ pinned: string[] }>(alice, "GET", `/rooms/${encodeURIComponent(roomId)}/state/m.room.pinned_events/`)
  expect(pins.pinned).toHaveLength(1)

  // Report the message (goes to the homeserver admins).
  await sendMessage(alicePage, "Spam spam spam")
  await messageRow(bobPage, "Spam spam spam").hover()
  await bobPage.getByRole("button", { name: "Mehr" }).click()
  await bobPage.getByRole("menuitem", { name: "Nachricht melden" }).click()
  await bobPage.getByLabel("Grund").fill("Werbung")
  await bobPage.getByRole("button", { name: "Melden", exact: true }).click()
  await expect(bobPage.getByText("Meldung gesendet")).toBeVisible()

  // Ignore Alice from her profile in the member list: her messages disappear.
  await bobPage.getByRole("complementary", { name: "Mitglieder" }).getByRole("button", { name: new RegExp(alice.username) }).click()
  await bobPage.getByRole("button", { name: "Ignorieren" }).click()
  await bobPage.getByRole("alertdialog").getByRole("button", { name: "Ignorieren" }).click()
  await expect(messageRow(bobPage, "Spam spam spam")).toHaveCount(0)
  const ignored = await matrixApi<{ ignored_users: Record<string, unknown> }>(
    bob,
    "GET",
    `/user/${encodeURIComponent(bob.userId)}/account_data/m.ignored_user_list`,
  )
  expect(Object.keys(ignored.ignored_users)).toEqual([alice.userId])
})

test("notification level per channel, profile, presence and the about page", async ({ browser }) => {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")
  const roomName = `Settings ${Date.now().toString(36)}`
  const roomId = await createRoom(alice, { name: roomName, members: [bob] })

  const page = await newPage(browser)
  await login(page, alice)
  await openRoom(page, roomName)

  // Mute the channel from its header: an override push rule like Element's.
  await page.getByRole("button", { name: "Benachrichtigungen" }).click()
  await page.getByRole("menuitemradio", { name: "Stumm" }).click()
  await expect
    .poll(() =>
      matrixApi(alice, "GET", `/pushrules/global/override/${encodeURIComponent(roomId)}`).then(
        () => true,
        () => false,
      ),
    )
    .toBe(true)
  await page.keyboard.press("Escape")

  // Display name and presence from the user panel.
  await page.getByRole("button", { name: "Profil und Status" }).click()
  await page.getByRole("radio", { name: /Unsichtbar/ }).click()
  await page.getByRole("button", { name: "Profil und Status" }).click()
  await page.getByRole("button", { name: "Profil bearbeiten" }).click()
  await page.getByLabel("Anzeigename").fill("Alice Wunderland")
  await page.getByRole("button", { name: "Speichern", exact: true }).click()
  await expect(page.getByText("Profil gespeichert")).toBeVisible()
  const profile = await matrixApi<{ displayname: string }>(alice, "GET", `/profile/${encodeURIComponent(alice.userId)}`)
  expect(profile.displayname).toBe("Alice Wunderland")
  const presence = await matrixApi<{ presence: string }>(alice, "GET", `/presence/${encodeURIComponent(alice.userId)}/status`)
  expect(presence.presence).toBe("offline")

  // About: version, source link and the open source licenses.
  await page.getByRole("tab", { name: "Über" }).click()
  await expect(page.getByTestId("about-version")).toContainText("Version")
  await expect(page.getByRole("link", { name: "Quellcode dieser Version" })).toHaveAttribute("href", /github\.com\/Duell10111\/NexSpeak/)
  await expect(page.getByRole("list", { name: "Open-Source-Lizenzen" }).getByText(/^matrix-js-sdk \d/)).toBeVisible()
})
