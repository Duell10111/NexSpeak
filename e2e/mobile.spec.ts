import { expect, test } from "@playwright/test"
import { createRoom, login, messageRow, newPage, registerUser, sendMessage } from "./helpers"

test("mobile layout: navigation and members as slide-in panels", async ({ browser }) => {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")
  const roomName = `Mobil ${Date.now().toString(36)}`
  await createRoom(alice, { name: roomName, members: [bob] })

  const page = await newPage(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await login(page, alice)

  // Sidebars are hidden on small screens, the chat uses the full width.
  await expect(page.getByRole("navigation", { name: "Server-Liste" })).toBeHidden()
  await page.getByRole("button", { name: "Navigation öffnen" }).first().click()
  await page.getByRole("dialog").getByRole("button", { name: new RegExp(roomName) }).click()
  await expect(page.getByRole("dialog")).toBeHidden()
  await expect(page.getByRole("heading", { level: 3, name: roomName })).toBeVisible()

  await sendMessage(page, "Vom Handy gesendet")
  await expect(messageRow(page, "Vom Handy gesendet")).toBeVisible()

  await page.getByRole("button", { name: "Mitgliederliste" }).click()
  await expect(page.getByRole("dialog").getByText(bob.username)).toBeVisible()

  // No horizontal scrolling.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
