import { expect, test } from "@playwright/test"
import { createRoom, login, messageRow, newPage, openRoom, registerUser, sendMessage } from "./helpers"

test("messages, typing, replies, reactions, edits and deletion", async ({ browser }) => {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")
  const roomName = `Lobby ${Date.now().toString(36)}`
  await createRoom(alice, { name: roomName, members: [bob] })

  const alicePage = await newPage(browser)
  const bobPage = await newPage(browser)
  await login(alicePage, alice)
  await login(bobPage, bob)
  await openRoom(alicePage, roomName)
  await openRoom(bobPage, roomName)

  // Plain message arrives on the other side.
  await sendMessage(alicePage, "Hallo Bob!")
  await expect(messageRow(bobPage, "Hallo Bob!")).toBeVisible()

  // Typing indicator.
  await bobPage.getByRole("textbox", { name: "Nachricht", exact: true }).pressSequentially("Moment", { delay: 50 })
  await expect(alicePage.getByText(/tippt…/)).toBeVisible()
  await bobPage.getByRole("textbox", { name: "Nachricht", exact: true }).fill("")

  // Reply.
  await messageRow(bobPage, "Hallo Bob!").hover()
  await bobPage.getByRole("button", { name: "Antworten" }).click()
  await expect(bobPage.getByText("Antwort an")).toBeVisible()
  await sendMessage(bobPage, "Hi Alice, schön dich zu sehen")
  const reply = messageRow(alicePage, "Hi Alice, schön dich zu sehen")
  await expect(reply).toBeVisible()
  await expect(reply.getByRole("button", { name: /Hallo Bob!/ })).toBeVisible()

  // Reaction, and taking it back.
  await reply.hover()
  await alicePage.getByRole("button", { name: "Reaktion hinzufügen" }).click()
  await alicePage.getByRole("option", { name: "👍" }).click()
  await expect(messageRow(bobPage, "schön dich zu sehen").getByRole("button", { name: "👍 1" })).toBeVisible()
  await reply.getByRole("button", { name: "👍 1" }).click()
  await expect(messageRow(bobPage, "schön dich zu sehen").getByRole("button", { name: "👍 1" })).toHaveCount(0)

  // Edit the last own message with arrow-up.
  const aliceComposer = alicePage.getByRole("textbox", { name: "Nachricht", exact: true })
  await aliceComposer.click()
  await aliceComposer.press("ArrowUp")
  const editor = alicePage.getByRole("textbox", { name: "Nachricht bearbeiten" })
  await editor.fill("Hallo Bob, wie geht's?")
  await editor.press("Enter")
  const edited = messageRow(bobPage, "Hallo Bob, wie geht's?")
  await expect(edited).toBeVisible()
  await expect(edited.getByText("(bearbeitet)")).toBeVisible()

  // Delete.
  await messageRow(alicePage, "Hallo Bob, wie geht's?").hover()
  await alicePage.getByRole("button", { name: "Löschen" }).click()
  await alicePage.getByRole("alertdialog").getByRole("button", { name: "Löschen" }).click()
  await expect(messageRow(bobPage, "Hallo Bob, wie geht's?")).toHaveCount(0)
  await expect(bobPage.getByText("Nachricht gelöscht").first()).toBeVisible()
})
