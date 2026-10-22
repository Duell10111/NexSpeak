import { expect, test } from '@playwright/test'
import { createRoom, login, matrixApi, newPage, openRoom, registerUser } from './helpers'

test('explicit notification modes enable rules disabled by another client', async ({ browser }) => {
  const alice = await registerUser('disabledrules')
  const roomName = `Disabled rules ${Date.now().toString(36)}`
  const roomId = await createRoom(alice, { name: roomName, members: [] })
  const ruleId = encodeURIComponent(roomId)
  await matrixApi(alice, 'PUT', `/pushrules/global/room/${ruleId}`, { actions: ['notify'] })
  await matrixApi(alice, 'PUT', `/pushrules/global/room/${ruleId}/enabled`, { enabled: false })
  await matrixApi(alice, 'PUT', `/pushrules/global/override/${ruleId}`, {
    actions: [], conditions: [{ kind: 'event_match', key: 'room_id', pattern: roomId }],
  })
  await matrixApi(alice, 'PUT', `/pushrules/global/override/${ruleId}/enabled`, { enabled: false })
  const page = await newPage(browser)
  await login(page, alice)
  await openRoom(page, roomName)
  await page.getByRole('button', { name: 'Benachrichtigungen' }).click()
  await page.getByRole('menuitemradio', { name: 'Stumm', exact: true }).click()
  await expect(page.getByRole('menuitemradio', { name: 'Stumm', exact: true })).toBeChecked()
  await expect.poll(() => matrixApi(alice, 'GET', `/pushrules/global/override/${ruleId}/enabled`)).toEqual({ enabled: true })
  await page.keyboard.press('Escape')

  // Start with a disabled room rule again, then explicitly select all messages.
  await matrixApi(alice, 'DELETE', `/pushrules/global/override/${ruleId}`)
  await matrixApi(alice, 'PUT', `/pushrules/global/room/${ruleId}`, { actions: [] })
  await matrixApi(alice, 'PUT', `/pushrules/global/room/${ruleId}/enabled`, { enabled: false })
  await page.reload()
  await openRoom(page, roomName)
  await page.getByRole('button', { name: 'Benachrichtigungen' }).click()
  await page.getByRole('menuitemradio', { name: 'Alle Nachrichten', exact: true }).click()
  await expect(page.getByRole('menuitemradio', { name: 'Alle Nachrichten', exact: true })).toBeChecked()
  await expect.poll(() => matrixApi(alice, 'GET', `/pushrules/global/room/${ruleId}/enabled`)).toEqual({ enabled: true })
})
