import { expect, test } from "@playwright/test"
import { login, newPage, registerUser } from "./helpers"

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
