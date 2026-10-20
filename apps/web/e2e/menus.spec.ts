import { expect, test } from "@playwright/test"
import { createRoom, login, messageRow, newPage, openRoom, registerUser, sendMessage } from "./helpers"

test("a dialog opened from a menu leaves the page clickable, even while the menu is still closing", async ({ browser }) => {
  const alice = await registerUser("alice")
  const page = await newPage(browser)
  await login(page, alice)
  // Slow CI runners close the dialog before the menu's exit animation ends; pausing animations forces that.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Animation.enable")
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 0 })

  await page.getByRole("button", { name: "Server hinzufügen" }).click()
  await page.getByRole("menuitem", { name: "Server erstellen" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Abbrechen" }).click()
  await expect(page.getByRole("dialog")).toBeHidden()

  await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 })
  // Wait for the menu to finish closing: only then is nothing left that could restore the page.
  await expect(page.locator('[role=menu]')).toHaveCount(0)
  await expect(page.locator('[role=dialog]')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.body.style.pointerEvents)).not.toBe("none")
  await page.getByRole("button", { name: "Server hinzufügen" }).click({ timeout: 5_000 })
  await expect(page.getByRole("menuitem", { name: "Server erstellen" })).toBeVisible()
})

test("the reaction picker stays anchored when the pointer leaves the message", async ({ browser }) => {
  const alice = await registerUser("alice")
  const roomName = `Reactions ${Date.now().toString(36)}`
  await createRoom(alice, { name: roomName, members: [] })
  const page = await newPage(browser)
  await login(page, alice)
  await openRoom(page, roomName)
  await sendMessage(page, "React to this message")

  const row = messageRow(page, "React to this message")
  const trigger = row.getByRole("button", { name: "Reaktion hinzufügen" })
  await row.hover()
  await trigger.click()
  const picker = page.getByRole("listbox", { name: "Emoji auswählen" })
  const popup = page.locator('[data-slot="popover-content"]').filter({ has: picker })
  await expect(picker).toBeVisible()
  // Compare final geometry, after the opening animation has finished.
  await popup.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)))
  const position = await popup.boundingBox()
  expect(position).not.toBeNull()

  await page.mouse.move(2, 2)
  await expect(trigger).toBeVisible()
  for (const emoji of ["👍", "✨"]) {
    await picker.getByRole("option", { name: emoji, exact: true }).hover()
    const current = await popup.boundingBox()
    expect(current).not.toBeNull()
    expect(current!.x).toBeCloseTo(position!.x, 0)
    expect(current!.y).toBeCloseTo(position!.y, 0)
  }
  await picker.getByRole("option", { name: "✨", exact: true }).click()
  await expect(picker).toBeHidden()
  await expect(row.getByRole("button", { name: "✨ 1", exact: true })).toBeVisible()

  // Dismissal restores the usual hover-only toolbar once focus leaves the message.
  const composer = page.getByRole("textbox", { name: "Nachricht", exact: true })
  await composer.click()
  await expect(trigger).toBeHidden()
  await row.hover()
  await trigger.click()
  await page.mouse.move(2, 2)
  await page.keyboard.press("Escape")
  await expect(picker).toBeHidden()
  await composer.click()
  await expect(trigger).toBeHidden()

  // The More menu shares the toolbar and must keep its trigger visible too.
  await row.hover()
  const more = row.getByRole("button", { name: "Mehr", exact: true })
  await more.click()
  await page.mouse.move(2, 2)
  await expect(more).toBeVisible()
  await expect(page.getByRole("menu")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menu")).toBeHidden()
})
