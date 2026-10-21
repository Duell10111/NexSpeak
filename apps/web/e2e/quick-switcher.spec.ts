import { expect, test } from "@playwright/test"
import { createRoom, createSpace, login, matrixApi, newPage, registerUser } from "./helpers"

test("quick switcher navigates joined servers, channels and direct messages with the keyboard", async ({ browser }) => {
  const alice = await registerUser("switch-alice")
  const bob = await registerUser("switch-bob")
  await createSpace(alice, { name: "Alpha Gaming", channels: [{ name: "General" }, { name: "Operations" }] })
  const directId = await createRoom(alice, { name: "Teammate", members: [bob] })
  await matrixApi(alice, "PUT", `/user/${encodeURIComponent(alice.userId)}/account_data/m.direct`, { [bob.userId]: [directId] })
  const page = await newPage(browser)
  await login(page, alice)
  let directoryRequests = 0
  page.on("request", (request) => { if (request.url().includes("/user_directory/search")) directoryRequests++ })

  // Shortcut capture owns the event before the local switcher's bubble listener.
  await page.evaluate(() => {
    const capture = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k") return
      event.preventDefault()
      window.removeEventListener("keydown", capture, true)
    }
    window.addEventListener("keydown", capture, true)
  })
  await page.keyboard.press("Control+k")
  await expect(page.getByRole("dialog", { name: "Schnellwechsler" })).not.toBeVisible()

  await matrixApi(bob, "PUT", `/rooms/${encodeURIComponent(directId)}/send/m.room.message/switch-mention`, {
    msgtype: "m.text", body: `Hello ${alice.userId}`, "m.mentions": { user_ids: [alice.userId] },
  })
  await page.keyboard.press("Control+k")
  const dialog = page.getByRole("dialog", { name: "Schnellwechsler" })
  const search = dialog.getByRole("combobox", { name: "Unterhaltungen suchen" })
  await expect(search).toBeFocused()
  const directOption = dialog.getByRole("option").filter({ hasText: "Teammate" })
  await expect(directOption.getByLabel("1 ungelesene Nachrichten")).toBeVisible()
  await expect(directOption.getByLabel("1 Erwähnungen")).toBeVisible()
  await search.fill("alpha")
  await search.press("Enter")
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole("heading", { level: 3, name: "General", exact: true })).toBeVisible()

  // A fuzzy channel name opens in its own server, including when starting from Home.
  await page.keyboard.press("Control+k")
  await search.fill("optn")
  await expect(dialog.getByRole("option")).toHaveCount(1)
  await expect(dialog.getByRole("option")).toContainText("Alpha Gaming")
  await search.press("Enter")
  await expect(page.getByRole("heading", { level: 3, name: "Operations", exact: true })).toBeVisible()

  const composer = page.getByRole("textbox", { name: "Nachricht", exact: true })
  await composer.click()
  await page.keyboard.press("Control+k")
  const first = dialog.getByRole("option").first()
  await expect(search).toHaveValue("")
  await expect(first).toContainText("Operations")
  await expect(first).toHaveAttribute("aria-selected", "true")
  await search.press("ArrowDown")
  await expect(dialog.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true")
  await search.press("ArrowUp")
  await expect(first).toHaveAttribute("aria-selected", "true")
  await search.fill("nothing matches this")
  await expect(dialog.getByRole("status")).toHaveText("Keine Unterhaltungen gefunden.")
  await search.press("Enter")
  await expect(dialog).toBeVisible()
  await search.press("Escape")
  await expect(dialog).not.toBeVisible()
  await expect(composer).toBeFocused()

  await page.keyboard.press("Control+k")
  await search.fill("teammate")
  await search.press("Enter")
  await expect(page.getByRole("heading", { level: 3, name: "Teammate", exact: true })).toBeVisible()
  expect(directoryRequests).toBe(0)
  await page.context().close()
})
