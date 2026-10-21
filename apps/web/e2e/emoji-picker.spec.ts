import { expect, test } from "@playwright/test"
import { createRoom, login, messageRow, newPage, openRoom, registerUser, sendMessage } from "./helpers"

test("Unicode picker searches names, remembers tones and frequency, and serves composer and reactions", async ({ browser }) => {
  const alice = await registerUser("emoji")
  const roomName = `Emoji ${Date.now().toString(36)}`
  await createRoom(alice, { name: roomName, members: [] })
  const page = await newPage(browser)
  await login(page, alice)
  await openRoom(page, roomName)
  const composer = page.getByRole("textbox", { name: "Nachricht", exact: true })
  const picker = page.getByRole("listbox", { name: "Emoji auswählen" })
  const search = page.getByRole("textbox", { name: "Emojis suchen" })

  await page.getByRole("button", { name: "Emoji einfügen", exact: true }).click()
  await expect(picker).toBeVisible()
  expect(await picker.getByRole("option").count()).toBeLessThanOrEqual(72)
  await page.getByRole("combobox", { name: "Hautfarbe", exact: true }).selectOption("3")
  await search.fill("Daumen hoch")
  await expect(picker.getByRole("option", { name: "👍🏽", exact: true })).toBeVisible()
  await expect(picker.getByRole("option", { name: "👍", exact: true })).toHaveCount(0)
  await picker.getByRole("option", { name: "👍🏽", exact: true }).click()
  await expect(composer).toHaveValue("👍🏽")
  await composer.press("Enter")
  await expect(messageRow(page, "👍🏽")).toBeVisible()

  await page.getByRole("button", { name: "Emoji einfügen", exact: true }).click()
  await expect(page.getByRole("combobox", { name: "Hautfarbe", exact: true })).toHaveValue("3")
  await page.getByRole("combobox", { name: "Emoji-Kategorie", exact: true }).selectOption("frequent")
  await expect(picker.getByRole("option", { name: "👍🏽", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")

  await sendMessage(page, "Unicode reaction")
  const row = messageRow(page, "Unicode reaction")
  await row.hover()
  await row.getByRole("button", { name: "Reaktion hinzufügen" }).click()
  await search.fill("rocket")
  await expect(picker.getByRole("option", { name: "🚀", exact: true })).toBeVisible()
  // Astronauts also match this keyword; navigate through the results to the rocket.
  const rocketIndex = Number(await picker.getByRole("option", { name: "🚀", exact: true }).getAttribute("data-emoji-index"))
  await search.press("ArrowDown")
  await expect(picker.getByRole("option").first()).toBeFocused()
  for (let index = 0; index < rocketIndex; index++) {
    await page.keyboard.press("ArrowRight")
    await expect(picker.locator(`[data-emoji-index="${index + 1}"]`)).toBeFocused()
  }
  await expect(picker.getByRole("option", { name: "🚀", exact: true })).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(row.getByRole("button", { name: "🚀 1", exact: true })).toBeVisible()

  await row.hover()
  await row.getByRole("button", { name: "Reaktion hinzufügen" }).click()
  await search.fill("no-such-emoji-123")
  await expect(page.getByText("Keine Emojis gefunden")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(picker).toBeHidden()
  await page.context().close()
})
