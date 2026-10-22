import { expect, test } from '@playwright/test'
import { createRoom, login, matrixApi, newPage, openRoom, registerUser } from './helpers'

test('typing indicators immediately follow ignore and unignore changes from another device', async ({ browser }) => {
  const alice = await registerUser('typingalice')
  const bob = await registerUser('typingbob')
  const carol = await registerUser('typingcarol')
  const roomName = `Typing ${Date.now().toString(36)}`
  const roomId = await createRoom(alice, { name: roomName, members: [bob, carol] })
  const page = await newPage(browser)
  await login(page, alice)
  await openRoom(page, roomName)

  const typingPath = `/rooms/${encodeURIComponent(roomId)}/typing/`
  const ignorePath = `/user/${encodeURIComponent(alice.userId)}/account_data/m.ignored_user_list`
  const indicator = page.getByText(`${bob.username} und ${carol.username} tippen…`, { exact: true })
  const carolOnly = page.getByText(`${carol.username} tippt…`, { exact: true })
  try {
    await matrixApi(bob, 'PUT', `${typingPath}${encodeURIComponent(bob.userId)}`, { typing: true, timeout: 90_000 })
    await matrixApi(carol, 'PUT', `${typingPath}${encodeURIComponent(carol.userId)}`, { typing: true, timeout: 90_000 })
    // Member order can vary; match both possible display orders.
    const both = indicator.or(page.getByText(`${carol.username} und ${bob.username} tippen…`, { exact: true }))
    await expect(both).toBeVisible()

    await matrixApi(alice, 'PUT', ignorePath, { ignored_users: { [bob.userId]: {} } })
    await expect(carolOnly).toBeVisible()
    await expect(both).toHaveCount(0)

    // No new typing event: the account-data change alone must restore Bob's indicator.
    await matrixApi(alice, 'PUT', ignorePath, { ignored_users: {} })
    await expect(both).toBeVisible()

    // Remounting the chat with an existing ignore list must also exclude Bob.
    await matrixApi(alice, 'PUT', ignorePath, { ignored_users: { [bob.userId]: {} } })
    await expect(carolOnly).toBeVisible()
    await page.reload()
    await openRoom(page, roomName)
    await expect(carolOnly).toBeVisible()
    await expect(both).toHaveCount(0)
  } finally {
    await matrixApi(bob, 'PUT', `${typingPath}${encodeURIComponent(bob.userId)}`, { typing: false })
    await matrixApi(carol, 'PUT', `${typingPath}${encodeURIComponent(carol.userId)}`, { typing: false })
  }
})
