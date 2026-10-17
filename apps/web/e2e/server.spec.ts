import { expect, test, type Locator, type Page } from "@playwright/test"
import { createSpace, getJoinedRoomIds, getState, login, newPage, registerUser, type TestUser } from "./helpers"

// 1×1 PNG, enough for an icon upload.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
)

function channel(page: Page, name: string): Locator {
  return page.getByRole("button", { name, exact: true })
}

async function top(locator: Locator): Promise<number> {
  return (await locator.boundingBox())?.y ?? Number.NaN
}

async function expectAbove(page: Page, upper: string, lower: string) {
  await expect.poll(async () => (await top(channel(page, upper))) < (await top(channel(page, lower)))).toBe(true)
}

async function openServer(page: Page, serverName: string) {
  await page.getByRole("navigation", { name: "Server-Liste" }).getByRole("button", { name: serverName }).click()
}

async function serverMenu(page: Page, item: string) {
  await page.getByRole("button", { name: "Servermenü" }).click()
  await page.getByRole("menuitem", { name: item }).click()
}

async function setupServer(): Promise<{ alice: TestUser; bob: TestUser; serverName: string; spaceId: string }> {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")
  const serverName = `Server ${Date.now().toString(36)}`
  const { spaceId } = await createSpace(alice, { name: serverName, channels: [{ name: "allgemein" }] })
  return { alice, bob, serverName, spaceId }
}

test("create, edit, move and delete channels and categories", async ({ browser }) => {
  const { alice, bob, serverName, spaceId } = await setupServer()

  // Bob is a member from the start and should see new channels without doing anything.
  await fetch(`http://localhost:8008/_matrix/client/v3/rooms/${encodeURIComponent(spaceId)}/invite`, {
    method: "POST",
    headers: { Authorization: `Bearer ${alice.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: bob.userId }),
  })
  const bobPage = await newPage(browser)
  await login(bobPage, bob)
  await bobPage.getByRole("button", { name: "Einladung annehmen" }).click()
  await openServer(bobPage, serverName)
  await expect(channel(bobPage, "allgemein")).toBeVisible()

  const page = await newPage(browser)
  await login(page, alice)
  await openServer(page, serverName)

  // Category and a channel inside it.
  await serverMenu(page, "Kategorie erstellen")
  await page.getByRole("dialog").getByLabel("Kategoriename").fill("Spiele")
  await page.getByRole("dialog").getByRole("button", { name: "Kategorie erstellen" }).click()
  await expect(page.getByRole("button", { name: "Spiele", exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Kanal in Spiele erstellen" }).click()
  let dialog = page.getByRole("dialog")
  await dialog.getByLabel("Kanalname").fill("minecraft")
  await dialog.getByRole("button", { name: "Kanal erstellen" }).click()
  await expect(page.getByRole("heading", { level: 3, name: "minecraft" })).toBeVisible()

  await serverMenu(page, "Kanal erstellen")
  dialog = page.getByRole("dialog")
  await dialog.getByLabel("Kanalname").fill("valorant")
  await dialog.getByLabel("Kategorie").click()
  await page.getByRole("option", { name: "Spiele" }).click()
  await dialog.getByRole("button", { name: "Kanal erstellen" }).click()
  await expect(page.getByRole("heading", { level: 3, name: "valorant" })).toBeVisible()
  await expectAbove(page, "minecraft", "valorant")

  // New channels appear for other members on their own.
  await expect(channel(bobPage, "minecraft")).toBeVisible({ timeout: 30_000 })
  await expect(channel(bobPage, "valorant")).toBeVisible({ timeout: 30_000 })

  // Reorder with the context menu and with drag and drop.
  await channel(page, "valorant").click({ button: "right" })
  await page.getByRole("menuitem", { name: "Nach oben" }).click()
  await expectAbove(page, "valorant", "minecraft")
  await expectAbove(bobPage, "valorant", "minecraft")

  await channel(page, "valorant").dragTo(channel(page, "minecraft"), { targetPosition: { x: 20, y: 28 } })
  await expectAbove(page, "minecraft", "valorant")

  // Move a channel out of the category.
  await channel(page, "valorant").click({ button: "right" })
  await page.getByRole("menuitem", { name: "Verschieben nach" }).click()
  await page.getByRole("menuitem", { name: "Ohne Kategorie" }).click()
  await expectAbove(page, "valorant", "Spiele")

  // Edit name, topic and icon.
  await channel(page, "minecraft").click({ button: "right" })
  await page.getByRole("menuitem", { name: "Kanal bearbeiten" }).click()
  dialog = page.getByRole("dialog")
  await dialog.getByLabel("Name").fill("minecraft-survival")
  await dialog.getByLabel("Kanalthema").fill("Nur Survival")
  await dialog.getByRole("button", { name: "Änderungen speichern" }).click()
  await expect(page.getByText("Gespeichert.")).toBeVisible()
  await dialog.locator('input[type="file"]').setInputFiles({ name: "icon.png", mimeType: "image/png", buffer: PNG })
  await expect(dialog.getByRole("button", { name: "Entfernen" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(channel(page, "minecraft-survival")).toBeVisible()
  await expect(channel(bobPage, "minecraft-survival")).toBeVisible()
  await channel(page, "minecraft-survival").click()
  await expect(page.getByText("Nur Survival")).toBeVisible()

  // Delete the category: its channel stays, without category.
  await page.getByRole("button", { name: "Spiele", exact: true }).click({ button: "right" })
  await page.getByRole("menuitem", { name: "Kategorie löschen" }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Löschen" }).click()
  await expect(page.getByRole("button", { name: "Spiele", exact: true })).toHaveCount(0)
  await expect(channel(page, "minecraft-survival")).toBeVisible()

  // Delete a channel: it disappears for everyone.
  await channel(page, "valorant").click({ button: "right" })
  await page.getByRole("menuitem", { name: "Kanal löschen" }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Löschen" }).click()
  await expect(channel(page, "valorant")).toHaveCount(0)
  await expect(channel(bobPage, "valorant")).toHaveCount(0)
})

test("server icon, description and roles", async ({ browser }) => {
  const { alice, bob, serverName, spaceId } = await setupServer()
  await fetch(`http://localhost:8008/_matrix/client/v3/rooms/${encodeURIComponent(spaceId)}/invite`, {
    method: "POST",
    headers: { Authorization: `Bearer ${alice.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: bob.userId }),
  })
  await fetch(`http://localhost:8008/_matrix/client/v3/join/${encodeURIComponent(spaceId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bob.accessToken}`, "Content-Type": "application/json" },
    body: "{}",
  })

  const page = await newPage(browser)
  await login(page, alice)
  await openServer(page, serverName)
  await serverMenu(page, "Servereinstellungen")
  const dialog = page.getByRole("dialog")

  await dialog.locator('input[type="file"]').setInputFiles({ name: "icon.png", mimeType: "image/png", buffer: PNG })
  await expect(dialog.getByRole("button", { name: "Entfernen" })).toBeVisible()
  await expect.poll(async () => (await getState<{ url?: string }>(alice, spaceId, "m.room.avatar"))?.url).toMatch(/^mxc:\/\//)

  await dialog.getByLabel("Beschreibung").fill("Für alle, die gerne spielen")
  await dialog.getByRole("button", { name: "Änderungen speichern" }).click()
  await expect.poll(async () => (await getState<{ topic?: string }>(alice, spaceId, "m.room.topic"))?.topic).toBe(
    "Für alle, die gerne spielen",
  )

  // Roles are power levels, applied in the server and its channels.
  await dialog.getByRole("tab", { name: "Mitglieder" }).click()
  await dialog.getByRole("combobox", { name: `Rolle von ${bob.username}` }).click()
  await page.getByRole("option", { name: "Moderator" }).click()
  await expect(page.getByText(`${bob.username} ist jetzt Moderator.`)).toBeVisible()
  const levels = await getState<{ users: Record<string, number> }>(alice, spaceId, "m.room.power_levels")
  expect(levels?.users[bob.userId]).toBe(50)

  // Kicking removes Bob from the server and its channels.
  await dialog.getByRole("button", { name: "Rauswerfen" }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Rauswerfen" }).click()
  await expect.poll(async () => (await getJoinedRoomIds(bob)).includes(spaceId)).toBe(false)

  // The new icon shows in the server list (hidden from the accessibility tree while the dialog is open).
  await dialog.getByRole("button", { name: "Schließen" }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole("navigation", { name: "Server-Liste" }).getByRole("button", { name: serverName }).locator("img")).toBeVisible()
})
