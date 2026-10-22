import { expect, test } from '@playwright/test'
import { createRoom, login, matrixApi, messageRow, newPage, openRoom, registerUser, type TestUser } from './helpers'

test('ignoring users hides their reply, thread and pin previews and follows remote unignore changes', async ({ browser }) => {
  const alice = await registerUser('previewalice')
  const bob = await registerUser('previewbob')
  const roomName = `Ignored previews ${Date.now().toString(36)}`
  const roomId = await createRoom(alice, { name: roomName, members: [bob] })
  let transaction = 0
  const send = async (user: TestUser, body: string, relation?: object) => {
    const { event_id } = await matrixApi<{ event_id: string }>(user, 'PUT', `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/preview-${transaction++}`, {
      msgtype: 'm.text', body, ...(relation && { 'm.relates_to': relation }),
    })
    return event_id
  }
  const bobQuote = await send(bob, 'Hidden quoted message')
  const bobRoot = await send(bob, 'Hidden pinned thread topic')
  const aliceRoot = await send(alice, 'Visible thread topic')
  await send(alice, 'Visible standalone reply', { 'm.in_reply_to': { event_id: bobQuote } })
  await send(alice, 'Visible thread reply', { rel_type: 'm.thread', event_id: bobRoot, is_falling_back: true, 'm.in_reply_to': { event_id: bobRoot } })
  await send(bob, 'Hidden latest thread reply', { rel_type: 'm.thread', event_id: aliceRoot, is_falling_back: true, 'm.in_reply_to': { event_id: aliceRoot } })
  await matrixApi(alice, 'PUT', `/rooms/${encodeURIComponent(roomId)}/state/m.room.pinned_events/`, { pinned: [bobRoot] })
  const ignorePath = `/user/${encodeURIComponent(alice.userId)}/account_data/m.ignored_user_list`
  const page = await newPage(browser)
  await login(page, alice)
  await openRoom(page, roomName)
  await expect(messageRow(page, 'Visible standalone reply')).toContainText('Hidden quoted message')
  await expect(messageRow(page, 'Visible thread topic')).toContainText('Hidden latest thread reply')
  await page.getByRole('button', { name: 'Angeheftete Nachrichten' }).click()
  const pins = page.getByRole('dialog')
  await expect(pins.getByText('Hidden pinned thread topic', { exact: true })).toBeVisible()

  await matrixApi(alice, 'PUT', ignorePath, { ignored_users: { [bob.userId]: {} } })
  await expect(pins.getByText('Hidden pinned thread topic', { exact: true })).toHaveCount(0)
  await matrixApi(alice, 'PUT', ignorePath, { ignored_users: {} })
  await expect(pins.getByText('Hidden pinned thread topic', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Threads', exact: true }).click()
  const threads = page.getByRole('complementary', { name: 'Threads', exact: true })
  await expect(threads.getByText('Hidden pinned thread topic', { exact: true })).toBeVisible()
  await expect(threads).toContainText('Hidden latest thread reply')
  await matrixApi(alice, 'PUT', ignorePath, { ignored_users: { [bob.userId]: {} } })
  await expect(threads.getByText('Hidden pinned thread topic', { exact: true })).toHaveCount(0)
  await expect(threads).not.toContainText('Hidden latest thread reply')
  await expect(threads.getByText('Visible thread topic', { exact: true })).toBeVisible()
  await expect(messageRow(page, 'Visible standalone reply')).not.toContainText('Hidden quoted message')
  await expect(messageRow(page, 'Visible thread topic')).not.toContainText('Hidden latest thread reply')
  await matrixApi(alice, 'PUT', ignorePath, { ignored_users: {} })
  await expect(threads.getByText('Hidden pinned thread topic', { exact: true })).toBeVisible()
  await expect(threads).toContainText('Hidden latest thread reply')
  await expect(messageRow(page, 'Visible standalone reply')).toContainText('Hidden quoted message')
})
