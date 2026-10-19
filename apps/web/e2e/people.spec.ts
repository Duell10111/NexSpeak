import { expect, test, type Page } from "@playwright/test"
import { createSpace, getDirectRooms, login, messageRow, newPage, registerUser, sendMessage } from "./helpers"

async function pickUser(page: Page, userId: string) {
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("textbox", { name: "Personen suchen" }).fill(userId)
  await dialog.getByRole("option", { name: new RegExp(userId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).click()
  return dialog
}

test("start a direct message with someone you share no room with", async ({ browser }) => {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")

  const alicePage = await newPage(browser)
  await login(alicePage, alice)

  await alicePage.getByRole("button", { name: "Unterhaltung finden oder starten" }).click()
  const dialog = await pickUser(alicePage, bob.userId)
  await dialog.getByRole("button", { name: "Nachricht schreiben" }).click()
  await expect(dialog).toBeHidden()
  await expect(alicePage.getByRole("heading", { level: 3, name: bob.username })).toBeVisible()
  await sendMessage(alicePage, "Hallo Bob, direkt!")
  await expect(messageRow(alicePage, "Hallo Bob, direkt!")).toBeVisible()

  const aliceDirect = await getDirectRooms(alice)
  expect(aliceDirect[bob.userId]).toHaveLength(1)
  const roomId = aliceDirect[bob.userId][0]

  // Bob gets it as an invite on the home screen and lands in the DM when accepting.
  const bobPage = await newPage(browser)
  await login(bobPage, bob)
  const invite = bobPage.locator("div").filter({ hasText: alice.username }).filter({ has: bobPage.getByRole("button", { name: "Einladung annehmen" }) }).last()
  await invite.getByRole("button", { name: "Einladung annehmen" }).click()
  await expect(messageRow(bobPage, "Hallo Bob, direkt!")).toBeVisible()
  await expect(bobPage.getByRole("heading", { level: 3, name: alice.username })).toBeVisible()
  await expect.poll(async () => (await getDirectRooms(bob))[alice.userId]).toEqual([roomId])

  // Starting a DM from the member list opens the existing one instead of a new room.
  await sendMessage(bobPage, "Hi Alice!")
  await expect(messageRow(alicePage, "Hi Alice!")).toBeVisible()
  await alicePage.getByRole("complementary", { name: "Mitglieder" }).getByRole("button", { name: new RegExp(bob.username) }).click()
  await alicePage.getByRole("button", { name: "Nachricht senden" }).click()
  await expect(alicePage.getByRole("heading", { level: 3, name: bob.username })).toBeVisible()
  expect((await getDirectRooms(alice))[bob.userId]).toEqual([roomId])
})

test("friends: send a request, accept it, message and remove the friend", async ({ browser }) => {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")
  const alicePage = await newPage(browser)
  const bobPage = await newPage(browser)
  await login(alicePage, alice)
  await login(bobPage, bob)

  // Home opens on the friends view; Alice adds Bob without sharing a room.
  await expect(alicePage.getByRole("heading", { level: 3, name: "Freunde" })).toBeVisible()
  await alicePage.getByRole("button", { name: "Freund hinzufügen" }).click()
  const dialog = await pickUser(alicePage, bob.userId)
  await dialog.getByRole("button", { name: "Freundschaftsanfrage senden" }).click()
  await expect(dialog).toBeHidden()
  await alicePage.getByRole("tab", { name: "Ausstehend" }).click()
  await expect(alicePage.getByText("Ausgehende Freundschaftsanfrage")).toBeVisible()

  // Bob gets it as a friend request, not as a plain invite, and accepts it.
  const accept = bobPage.getByRole("button", { name: `Freundschaftsanfrage von ${alice.username} annehmen` })
  await expect(accept).toBeVisible()
  await expect(bobPage.getByRole("button", { name: "Einladung annehmen" })).toHaveCount(0)
  await accept.click()
  await bobPage.getByRole("tab", { name: "Alle" }).click()
  await expect(bobPage.getByRole("button", { name: `Nachricht an ${alice.username}` })).toBeVisible()
  await alicePage.getByRole("tab", { name: "Alle" }).click()
  const message = alicePage.getByRole("button", { name: `Nachricht an ${bob.username}` })
  await expect(message).toBeVisible()

  // "Message" opens the DM that carries the friendship.
  await message.click()
  await expect(alicePage.getByRole("heading", { level: 3, name: bob.username })).toBeVisible()
  await sendMessage(alicePage, "Jetzt sind wir Freunde!")

  // Removing ends the friendship for both; the DM stays.
  await alicePage.getByRole("button", { name: "Freunde", exact: true }).click()
  await alicePage.getByRole("tab", { name: "Alle" }).click()
  await alicePage.getByRole("button", { name: `Weitere Aktionen für ${bob.username}` }).click()
  await alicePage.getByRole("menuitem", { name: "Freund entfernen" }).click()
  await alicePage.getByRole("alertdialog").getByRole("button", { name: "Freund entfernen" }).click()
  await expect(alicePage.getByText("Du hast noch keine Freunde.", { exact: false })).toBeVisible()
  await expect(bobPage.getByText("Du hast noch keine Freunde.", { exact: false })).toBeVisible()
  await bobPage.getByRole("button", { name: new RegExp(alice.username) }).first().click()
  await expect(messageRow(bobPage, "Jetzt sind wir Freunde!")).toBeVisible()
})

test("invite someone to a server; private channels need their own invite", async ({ browser }) => {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")
  const serverName = `Gilde ${Date.now().toString(36)}`
  await createSpace(alice, {
    name: serverName,
    channels: [{ name: "allgemein" }, { name: "geheim", inviteOnly: true }],
  })

  const alicePage = await newPage(browser)
  await login(alicePage, alice)
  await alicePage.getByRole("navigation", { name: "Server-Liste" }).getByRole("button", { name: serverName }).click()
  await alicePage.getByRole("button", { name: "Servermenü" }).click()
  await alicePage.getByRole("menuitem", { name: "Personen einladen" }).click()
  const dialog = await pickUser(alicePage, bob.userId)
  await dialog.getByRole("button", { name: "Einladen" }).click()
  await expect(alicePage.getByText(`${bob.username} wurde eingeladen.`)).toBeVisible()

  const bobPage = await newPage(browser)
  await login(bobPage, bob)
  const invite = bobPage.locator("div").filter({ hasText: serverName }).filter({ has: bobPage.getByRole("button", { name: "Einladung annehmen" }) }).last()
  await invite.getByRole("button", { name: "Einladung annehmen" }).click()

  // Accepting the server joins its open channels; the private one stays hidden.
  await bobPage.getByRole("navigation", { name: "Server-Liste" }).getByRole("button", { name: serverName }).click()
  await expect(bobPage.getByRole("button", { name: "allgemein", exact: true })).toBeVisible()
  await expect(bobPage.getByRole("button", { name: "geheim", exact: true })).toHaveCount(0)

  // Alice adds Bob to the private channel from its context menu.
  await alicePage.getByRole("button", { name: "geheim", exact: true }).click({ button: "right" })
  await alicePage.getByRole("menuitem", { name: "Mitglieder hinzufügen" }).click()
  const addDialog = alicePage.getByRole("dialog")
  await addDialog.getByRole("option", { name: new RegExp(bob.username) }).click()
  await addDialog.getByRole("button", { name: "Hinzufügen" }).click()
  await expect(addDialog).toBeHidden()

  await bobPage.getByRole("button", { name: "Direktnachrichten" }).click()
  await bobPage.getByRole("button", { name: "Einladung annehmen" }).click()
  await bobPage.getByRole("navigation", { name: "Server-Liste" }).getByRole("button", { name: serverName }).click()
  await expect(bobPage.getByRole("button", { name: "geheim", exact: true })).toBeVisible()
})

test("switch the interface language", async ({ browser }) => {
  const page = await newPage(browser)
  await page.goto("/login")
  await expect(page.getByLabel("Benutzername")).toBeVisible()

  await page.getByRole("button", { name: "English" }).click()
  await expect(page.getByLabel("Username")).toBeVisible()
  await expect(page.locator("html")).toHaveAttribute("lang", "en")

  // The choice is remembered across reloads, regardless of the browser language.
  await page.reload()
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible()

  await page.getByRole("button", { name: "Deutsch" }).click()
  await expect(page.getByRole("button", { name: "Anmelden" })).toBeVisible()
})
