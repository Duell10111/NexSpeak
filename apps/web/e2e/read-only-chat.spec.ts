import { expect, test } from '@playwright/test'
import { createRoom, login, matrixApi, messageRow, newPage, openRoom, registerUser } from './helpers'

for (const encrypted of [false, true]) {
  test(`read-only composer follows live permission changes and retains drafts (${encrypted ? 'encrypted' : 'plain'})`, async ({ browser }) => {
    const alice = await registerUser('readonlyadmin')
    const bob = await registerUser('readonlymember')
    const roomName = `Read-only ${Date.now().toString(36)}`
    const roomId = await createRoom(alice, { name: roomName, members: [bob], encrypted })
    const path = `/rooms/${encodeURIComponent(roomId)}/state/m.room.power_levels/`
    const original = await matrixApi<{ events?: Record<string, number> }>(alice, 'GET', path)
    // An encrypted room is authorized using m.room.encrypted, even when m.room.message is allowed.
    const type = encrypted ? 'm.room.encrypted' : 'm.room.message'
    await matrixApi(alice, 'PUT', path, { ...original, events: { ...original.events, [type]: 50 } })
    const page = await newPage(browser)
    await login(page, bob)
    await openRoom(page, roomName)
    const composer = page.getByRole('textbox', { name: 'Nachricht', exact: true })
    await expect(composer).toBeDisabled()
    await expect(composer).toHaveAttribute('placeholder', 'Du darfst in diesem Raum keine Nachrichten senden.')
    await expect(page.getByRole('button', { name: 'Datei anhängen', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Umfrage erstellen', exact: true })).toBeDisabled()

    await matrixApi(alice, 'PUT', path, original)
    await expect(composer).toBeEnabled()
    await composer.fill('Keep my draft through permission changes')
    await matrixApi(alice, 'PUT', path, { ...original, events: { ...original.events, [type]: 50 } })
    await expect(composer).toBeDisabled()
    await expect(composer).toHaveValue('Keep my draft through permission changes')
    await matrixApi(alice, 'PUT', path, original)
    await expect(composer).toBeEnabled()
    await composer.press('Enter')
    await expect(messageRow(page, 'Keep my draft through permission changes')).toBeVisible()
    await expect(messageRow(page, 'Keep my draft through permission changes')).not.toHaveClass(/opacity-60/)
  })
}
