import { expect, test } from '@playwright/test'
import { createRoom, getRoomMessages, login, messageRow, newPage, openRoom, registerUser, sendMessage } from './helpers'

test('a failed message edit preserves its draft and can be retried', async ({ browser }) => {
  const alice = await registerUser('editretry')
  const roomName = `Edit retry ${Date.now().toString(36)}`
  const roomId = await createRoom(alice, { name: roomName, members: [] })
  const page = await newPage(browser)
  await login(page, alice)
  await openRoom(page, roomName)
  await sendMessage(page, 'Original message')
  await expect(messageRow(page, 'Original message')).not.toHaveClass(/opacity-60/)
  let attempts = 0
  await page.route('**/rooms/*/send/m.room.message/*', async (route) => {
    const content = route.request().postDataJSON()
    if (content?.['m.relates_to']?.rel_type !== 'm.replace') return route.continue()
    attempts++
    if (attempts === 1) return route.fulfill({ status: 403, json: { errcode: 'M_FORBIDDEN', error: 'Simulated edit rejection' } })
    return route.continue()
  })
  await messageRow(page, 'Original message').hover()
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click()
  const editor = page.getByRole('textbox', { name: 'Nachricht bearbeiten' })
  await editor.fill('Draft worth keeping')
  await editor.press('Enter')
  await expect(page.getByText('Dafür fehlt dir die Berechtigung.', { exact: true })).toBeVisible()
  await expect(editor).toBeVisible()
  await expect(editor).toBeEnabled()
  await expect(editor).toBeFocused()
  await expect(editor).toHaveValue('Draft worth keeping')
  await editor.press('Enter')
  await expect(editor).toHaveCount(0)
  await expect.poll(async () => (await getRoomMessages(alice, roomId)).filter((event) =>
    (event.content['m.new_content'] as { body?: unknown } | undefined)?.body === 'Draft worth keeping').length).toBe(1)
  expect(attempts).toBe(2)
  await expect(messageRow(page, 'Draft worth keeping')).toBeVisible()
})

test('a delayed edit keeps the editor open and prevents duplicate saves', async ({ browser }) => {
  const alice = await registerUser('editslow')
  const roomName = `Edit slow ${Date.now().toString(36)}`
  await createRoom(alice, { name: roomName, members: [] })
  const page = await newPage(browser)
  await login(page, alice)
  await openRoom(page, roomName)
  await sendMessage(page, 'Original slow message')
  await expect(messageRow(page, 'Original slow message')).not.toHaveClass(/opacity-60/)
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let requests = 0
  await page.route('**/rooms/*/send/m.room.message/*', async (route) => {
    if (route.request().postDataJSON()?.['m.relates_to']?.rel_type !== 'm.replace') return route.continue()
    requests++
    await gate
    return route.continue()
  })
  try {
    await messageRow(page, 'Original slow message').hover()
    await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click()
    const editor = page.getByRole('textbox', { name: 'Nachricht bearbeiten' })
    await editor.fill('Saved after waiting')
    await editor.press('Enter')
    await expect.poll(() => requests).toBe(1)
    await expect(editor).toBeVisible()
    await expect(editor).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled()
    release()
    await expect(editor).toHaveCount(0)
    expect(requests).toBe(1)
    await expect(messageRow(page, 'Saved after waiting')).toBeVisible()
  } finally { release() }
})
