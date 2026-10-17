import { expect, test } from "@playwright/test"
import { createRoom, login, messageRow, newPage, openRoom, registerUser, sendMessage } from "./helpers"

test("recovery key setup, verification on a new device and key backup restore", async ({ browser }) => {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")
  const roomName = `Backup ${Date.now().toString(36)}`
  await createRoom(alice, { name: roomName, members: [bob], encrypted: true })

  // Device 1: set up recovery and send an encrypted message.
  const device1 = await newPage(browser)
  await login(device1, alice)
  await device1.getByRole("button", { name: "Einstellungen" }).click()
  await device1.getByRole("tab", { name: "Sicherheit" }).click()
  await device1.getByLabel("Passwort").fill(alice.password)
  await device1.getByRole("button", { name: "Recovery-Schlüssel erstellen" }).click()
  const recoveryKey = (await device1.getByTestId("recovery-key").textContent())?.trim() ?? ""
  expect(recoveryKey.length).toBeGreaterThan(40)
  await device1.getByLabel("Ich habe den Schlüssel sicher gespeichert.").check()
  await device1.getByRole("button", { name: "Fertig" }).click()
  await expect(device1.getByText("Dieses Gerät ist verifiziert")).toBeVisible()
  await expect(device1.getByText("Schlüssel-Backup aktiv")).toBeVisible()
  await device1.keyboard.press("Escape")

  await openRoom(device1, roomName)
  await sendMessage(device1, "Nachricht vor dem neuen Gerät")
  await expect(messageRow(device1, "Nachricht vor dem neuen Gerät")).toBeVisible()
  // Give the backup a moment to upload the room key.
  await device1.waitForTimeout(3000)

  // Device 2: unverified until the recovery key is entered; then old messages decrypt.
  const device2 = await newPage(browser)
  await login(device2, alice)
  await expect(device2.getByText("Dieses Gerät ist nicht verifiziert")).toBeVisible()
  await device2.getByRole("button", { name: "Jetzt verifizieren" }).click()
  await device2.getByLabel("Recovery-Schlüssel").fill(recoveryKey)
  await device2.getByRole("button", { name: "Mit Recovery-Schlüssel verifizieren" }).click()
  await expect(device2.getByText(/Gerät verifiziert/)).toBeVisible({ timeout: 30_000 })
  await device2.keyboard.press("Escape")
  await expect(device2.getByText("Dieses Gerät ist nicht verifiziert")).toHaveCount(0)

  await openRoom(device2, roomName)
  await expect(messageRow(device2, "Nachricht vor dem neuen Gerät")).toBeVisible({ timeout: 30_000 })

  // Device 3: verify interactively by comparing emojis with device 1.
  const device3 = await newPage(browser)
  await login(device3, alice)
  await device3.getByRole("button", { name: "Jetzt verifizieren" }).click()
  await device3.getByRole("button", { name: "Mit einem anderen Gerät verifizieren" }).click()
  await device1.getByRole("button", { name: "Annehmen" }).click()

  for (const page of [device1, device3]) {
    await expect(page.getByRole("button", { name: "Stimmen überein" })).toBeVisible({ timeout: 30_000 })
  }
  const emojis1 = await device1.getByRole("dialog").locator(".text-3xl").allTextContents()
  const emojis3 = await device3.getByRole("dialog").locator(".text-3xl").allTextContents()
  expect(emojis1).toHaveLength(7)
  expect(emojis3).toEqual(emojis1)

  await device1.getByRole("button", { name: "Stimmen überein" }).click()
  await device3.getByRole("button", { name: "Stimmen überein" }).click()
  for (const page of [device1, device3]) {
    await expect(page.getByText("Verifizierung erfolgreich")).toBeVisible({ timeout: 30_000 })
  }
})
