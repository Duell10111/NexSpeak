import { expect, test, type Locator, type Page } from "@playwright/test"
import { createSpace, getJoinedRoomIds, getState, login, newPage, registerUser, type TestUser } from "./helpers"

// 1×1 PNG, enough for an icon upload.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
)

const ADMIN_EVENTS = {
  'm.room.power_levels': 100,
  'm.room.history_visibility': 100,
  'm.room.encryption': 100,
  'm.room.tombstone': 100,
  'm.room.server_acl': 100,
}

function channel(page: Page, name: string): Locator {
  return page.getByRole("button", { name, exact: true })
}

async function top(locator: Locator): Promise<number> {
  return (await locator.boundingBox())?.y ?? Number.NaN
}

async function expectAbove(page: Page, upper: string, lower: string) {
  await expect.poll(async () => (await top(channel(page, upper))) < (await top(channel(page, lower)))).toBe(true)
}

async function openServer(page: Page, serverName: string) {
  await page.getByRole("navigation", { name: "Server-Liste" }).getByRole("button", { name: serverName }).click()
}

async function serverMenu(page: Page, item: string) {
  await page.getByRole("button", { name: "Servermenü" }).click()
  await page.getByRole("menuitem", { name: item }).click()
}

async function setupServer(): Promise<{ alice: TestUser; bob: TestUser; serverName: string; spaceId: string }> {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")
  const serverName = `Server ${Date.now().toString(36)}`
  const { spaceId } = await createSpace(alice, { name: serverName, channels: [{ name: "allgemein" }] })
  return { alice, bob, serverName, spaceId }
}

for (const withDetails of [false, true]) {
  test(`create and open a server ${withDetails ? 'with an icon and description' : 'with only a name'}`, async ({ browser }) => {
    const { alice } = await setupServer()
    const page = await newPage(browser)
    await login(page, alice)
    if (!withDetails) {
      // Also exercise older homeservers: v11 assigns creator 100; v12+ forbids
      // putting the creator in power_levels.users and assigns their role implicitly.
      await page.route('**/_matrix/client/v3/createRoom', async (route) => {
        await route.continue({ postData: JSON.stringify({ ...route.request().postDataJSON(), room_version: '11' }) })
      })
    }
    await page.getByRole('button', { name: 'Server hinzufügen' }).click()
    await page.getByRole('menuitem', { name: 'Server erstellen' }).click()
    const dialog = page.getByRole('dialog')
    const submit = dialog.getByRole('button', { name: 'Server erstellen' })
    await expect(submit).toBeDisabled()
    await dialog.getByLabel('Name', { exact: true }).fill('   ')
    await expect(submit).toBeDisabled()

    // Cancelled drafts must be discarded.
    await dialog.getByLabel('Name', { exact: true }).fill('Discarded draft')
    await dialog.getByRole('button', { name: 'Abbrechen' }).click()
    await page.getByRole('button', { name: 'Server hinzufügen' }).click()
    await page.getByRole('menuitem', { name: 'Server erstellen' }).click()
    await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('')

    const name = `Created ${Date.now().toString(36)}`
    await dialog.getByLabel('Name', { exact: true }).fill(`  ${name}  `)
    if (withDetails) {
      await dialog.getByLabel('Beschreibung').fill('  A place for games  ')
      await dialog.getByLabel('Icon', { exact: true }).setInputFiles({ name: 'icon.png', mimeType: 'image/png', buffer: PNG })
      await expect(dialog.getByRole('img', { name: 'Icon' })).toBeVisible()
    }
    await submit.click()
    await expect(dialog).toBeHidden()
    const serverButton = page.getByRole('navigation', { name: 'Server-Liste' }).getByRole('button', { name, exact: true })
    await expect(serverButton).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('heading', { level: 3, name: 'general', exact: true })).toBeVisible()

    const selection = await page.evaluate(() => JSON.parse(localStorage.getItem('nexspeak_selection')!))
    const serverId = selection.serverId as string
    const channelId = selection.channelId as string
    expect(await getState(alice, serverId, 'm.room.create')).toMatchObject({ type: 'm.space' })
    expect(await getState(alice, serverId, 'm.room.name')).toEqual({ name })
    expect(await getState(alice, serverId, 'm.room.join_rules')).toMatchObject({ join_rule: 'invite' })
    expect(await getState(alice, serverId, 'm.space.child', channelId)).toMatchObject({ via: ['synapse'] })
    expect(await getState(alice, channelId, 'm.space.parent', serverId)).toMatchObject({ via: ['synapse'], canonical: true })
    expect(await getState(alice, channelId, 'm.room.join_rules')).toEqual({
      join_rule: 'restricted', allow: [{ type: 'm.room_membership', room_id: serverId }],
    })
    for (const roomId of [serverId, channelId]) {
      expect(await getState(alice, roomId, 'm.room.power_levels')).toMatchObject({
        users_default: 0, state_default: 50,
        events: { ...ADMIN_EVENTS, 'org.matrix.msc3401.call.member': 0 },
      })
      const creation = await getState<{ room_version: string }>(alice, roomId, 'm.room.create')
      const levels = await getState<{ users: Record<string, number> }>(alice, roomId, 'm.room.power_levels')
      expect(levels?.users[alice.userId]).toBe(creation?.room_version === '11' ? 100 : undefined)
    }
    if (withDetails) {
      expect(await getState(alice, serverId, 'm.room.topic')).toMatchObject({ topic: 'A place for games' })
      expect(await getState(alice, serverId, 'm.room.avatar')).toMatchObject({ url: expect.stringMatching(/^mxc:\/\//) })
      await expect(serverButton.locator('img')).toBeVisible()
    }

    await page.reload()
    await expect(serverButton).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('heading', { level: 3, name: 'general', exact: true })).toBeVisible()
    // Joining existing servers is still available from the same plus button.
    await page.getByRole('button', { name: 'Server hinzufügen' }).click()
    await page.getByRole('menuitem', { name: 'Server beitreten' }).click()
    await expect(dialog.getByLabel('Adresse')).toBeVisible()
  })
}

test('server creation failure preserves the draft and allows retry', async ({ browser }) => {
  const alice = await registerUser('creator')
  const page = await newPage(browser)
  await login(page, alice)
  await page.getByRole('button', { name: 'Server hinzufügen' }).click()
  await page.getByRole('menuitem', { name: 'Server erstellen' }).click()
  const dialog = page.getByRole('dialog')
  const name = `Retry ${Date.now().toString(36)}`
  await dialog.getByLabel('Name', { exact: true }).fill(name)
  await page.route('**/_matrix/client/v3/createRoom', (route) => route.fulfill({
    status: 400, contentType: 'application/json', body: JSON.stringify({ errcode: 'M_UNKNOWN', error: 'Creation failed' }),
  }))
  await dialog.getByRole('button', { name: 'Server erstellen' }).click()
  await expect(page.getByText('Creation failed', { exact: true })).toBeVisible()
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue(name)
  await page.unroute('**/_matrix/client/v3/createRoom')
  await dialog.getByRole('button', { name: 'Server erstellen' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('heading', { level: 3, name: 'general', exact: true })).toBeVisible()
})

test('create a server on mobile and close navigation to show its first channel', async ({ browser }) => {
  const alice = await registerUser('mobile-creator')
  const page = await newPage(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await login(page, alice)
  await page.getByRole('button', { name: 'Navigation öffnen' }).first().click()
  await page.getByRole('button', { name: 'Server hinzufügen' }).click()
  await page.getByRole('menuitem', { name: 'Server erstellen' }).click()
  const dialog = page.getByRole('dialog', { name: 'Server erstellen', exact: true })
  await dialog.getByLabel('Name', { exact: true }).fill('Mobile server')
  await dialog.getByRole('button', { name: 'Server erstellen' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByRole('heading', { level: 3, name: 'general', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
})

test("create, edit, move and delete channels and categories", async ({ browser }) => {
  const { alice, bob, serverName, spaceId } = await setupServer()

  // Bob is a member from the start and should see new channels without doing anything.
  await fetch(`http://localhost:8008/_matrix/client/v3/rooms/${encodeURIComponent(spaceId)}/invite`, {
    method: "POST",
    headers: { Authorization: `Bearer ${alice.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: bob.userId }),
  })
  const bobPage = await newPage(browser)
  await login(bobPage, bob)
  await bobPage.getByRole("button", { name: "Einladung annehmen" }).click()
  await openServer(bobPage, serverName)
  await expect(channel(bobPage, "allgemein")).toBeVisible()

  const page = await newPage(browser)
  await login(page, alice)
  await openServer(page, serverName)

  // Category and a channel inside it.
  await serverMenu(page, "Kategorie erstellen")
  await page.getByRole("dialog").getByLabel("Kategoriename").fill("Spiele")
  const categoryCreated = page.waitForResponse((response) => response.url().endsWith('/createRoom') && response.request().method() === 'POST')
  await page.getByRole("dialog").getByRole("button", { name: "Kategorie erstellen" }).click()
  const { room_id: categoryId } = await (await categoryCreated).json()
  await expect(page.getByRole("button", { name: "Spiele", exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Kanal in Spiele erstellen" }).click()
  let dialog = page.getByRole("dialog")
  await dialog.getByLabel("Kanalname").fill("minecraft")
  await dialog.getByRole("button", { name: "Kanal erstellen" }).click()
  await expect(page.getByRole("heading", { level: 3, name: "minecraft" })).toBeVisible()
  const minecraftId = await page.evaluate(() => JSON.parse(localStorage.getItem('nexspeak_selection')!).channelId as string)

  await serverMenu(page, "Kanal erstellen")
  dialog = page.getByRole("dialog")
  await dialog.getByLabel("Kanalname").fill("valorant")
  await dialog.getByLabel("Kategorie").click()
  await page.getByRole("option", { name: "Spiele" }).click()
  await dialog.getByRole("button", { name: "Kanal erstellen" }).click()
  await expect(page.getByRole("heading", { level: 3, name: "valorant" })).toBeVisible()
  const valorantId = await page.evaluate(() => JSON.parse(localStorage.getItem('nexspeak_selection')!).channelId as string)
  for (const roomId of [categoryId, minecraftId, valorantId]) {
    expect(await getState(alice, roomId, 'm.room.power_levels')).toMatchObject({
      users_default: 0, state_default: 50,
      events: { ...ADMIN_EVENTS, 'org.matrix.msc3401.call.member': 0 },
    })
  }
  await expectAbove(page, "minecraft", "valorant")

  // New channels appear for other members on their own.
  await expect(channel(bobPage, "minecraft")).toBeVisible({ timeout: 30_000 })
  await expect(channel(bobPage, "valorant")).toBeVisible({ timeout: 30_000 })

  // Reorder with the context menu and with drag and drop.
  await channel(page, "valorant").click({ button: "right" })
  await page.getByRole("menuitem", { name: "Nach oben" }).click()
  await expectAbove(page, "valorant", "minecraft")
  await expectAbove(bobPage, "valorant", "minecraft")

  await channel(page, "valorant").dragTo(channel(page, "minecraft"), { targetPosition: { x: 20, y: 28 } })
  await expectAbove(page, "minecraft", "valorant")

  // Move a channel out of the category.
  await channel(page, "valorant").click({ button: "right" })
  await page.getByRole("menuitem", { name: "Verschieben nach" }).click()
  await page.getByRole("menuitem", { name: "Ohne Kategorie" }).click()
  await expectAbove(page, "valorant", "Spiele")

  // Edit name, topic and icon.
  await channel(page, "minecraft").click({ button: "right" })
  await page.getByRole("menuitem", { name: "Kanal bearbeiten" }).click()
  dialog = page.getByRole("dialog")
  await dialog.getByLabel("Name").fill("minecraft-survival")
  await dialog.getByLabel("Kanalthema").fill("Nur Survival")
  await dialog.getByRole("button", { name: "Änderungen speichern" }).click()
  await expect(page.getByText("Gespeichert.")).toBeVisible()
  await dialog.locator('input[type="file"]').setInputFiles({ name: "icon.png", mimeType: "image/png", buffer: PNG })
  await expect(dialog.getByRole("button", { name: "Entfernen" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(channel(page, "minecraft-survival")).toBeVisible()
  await expect(channel(bobPage, "minecraft-survival")).toBeVisible()
  await channel(page, "minecraft-survival").click()
  await expect(page.getByText("Nur Survival")).toBeVisible()

  // Delete the category: its channel stays, without category.
  await page.getByRole("button", { name: "Spiele", exact: true }).click({ button: "right" })
  await page.getByRole("menuitem", { name: "Kategorie löschen" }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Löschen" }).click()
  await expect(page.getByRole("button", { name: "Spiele", exact: true })).toHaveCount(0)
  await expect(channel(page, "minecraft-survival")).toBeVisible()

  // Delete a channel: it disappears for everyone.
  await channel(page, "valorant").click({ button: "right" })
  await page.getByRole("menuitem", { name: "Kanal löschen" }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Löschen" }).click()
  await expect(channel(page, "valorant")).toHaveCount(0)
  await expect(channel(bobPage, "valorant")).toHaveCount(0)
})

test('v11 moderators create categories and plain or encrypted channels with their inherited role', async ({ browser, request }) => {
  const alice = await registerUser('owner')
  const bob = await registerUser('moderator')
  const serverName = `Legacy ${Date.now().toString(36)}`
  const { spaceId } = await createSpace(alice, { name: serverName, roomVersion: '11', channels: [{ name: 'general' }] })
  const levels = await getState<{ users: Record<string, number> }>(alice, spaceId, 'm.room.power_levels')
  const roomsUrl = 'http://localhost:8008/_matrix/client/v3/rooms'
  const ownerHeaders = { Authorization: `Bearer ${alice.accessToken}` }
  expect((await request.put(`${roomsUrl}/${encodeURIComponent(spaceId)}/state/m.room.power_levels`, {
    headers: ownerHeaders, data: { ...levels, users: { ...levels!.users, [bob.userId]: 50 } },
  })).ok()).toBe(true)
  expect((await request.post(`${roomsUrl}/${encodeURIComponent(spaceId)}/invite`, {
    headers: ownerHeaders, data: { user_id: bob.userId },
  })).ok()).toBe(true)
  expect((await request.post(`http://localhost:8008/_matrix/client/v3/join/${encodeURIComponent(spaceId)}`, {
    headers: { Authorization: `Bearer ${bob.accessToken}` }, data: {},
  })).ok()).toBe(true)

  const page = await newPage(browser)
  await login(page, bob)
  await openServer(page, serverName)
  await serverMenu(page, 'Kategorie erstellen')
  await page.getByRole('dialog').getByLabel('Kategoriename').fill('Moderator category')
  const categoryCreated = page.waitForResponse((response) => response.url().endsWith('/createRoom') && response.request().method() === 'POST')
  await page.getByRole('dialog').getByRole('button', { name: 'Kategorie erstellen' }).click()
  const { room_id: categoryId } = await (await categoryCreated).json()
  await expect(page.getByRole('button', { name: 'Moderator category', exact: true })).toBeVisible()
  const createdIds: string[] = [categoryId]
  for (const encrypted of [false, true]) {
    const name = encrypted ? 'encrypted-by-mod' : 'plain-by-mod'
    await page.getByRole('button', { name: 'Kanal in Moderator category erstellen' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Kanalname').fill(name)
    if (encrypted) await dialog.getByLabel('Ende-zu-Ende-verschlüsselt', { exact: true }).check()
    await dialog.getByRole('button', { name: 'Kanal erstellen' }).click()
    await expect(page.getByRole('heading', { level: 3, name })).toBeVisible()
    const roomId = await page.evaluate(() => JSON.parse(localStorage.getItem('nexspeak_selection')!).channelId as string)
    createdIds.push(roomId)
    expect(await getState(bob, categoryId, 'm.space.child', roomId)).toMatchObject({ via: ['synapse'] })
    if (encrypted) expect(await getState(bob, roomId, 'm.room.encryption')).toMatchObject({ algorithm: 'm.megolm.v1.aes-sha2' })
  }
  for (const roomId of createdIds) {
    expect(await getState(bob, roomId, 'm.room.power_levels')).toMatchObject({
      users: { [alice.userId]: 100, [bob.userId]: 50 },
      events: { ...ADMIN_EVENTS, 'org.matrix.msc3401.call.member': 0 },
    })
    expect(await getState(bob, roomId, 'm.room.create')).toMatchObject({ room_version: '11' })
  }
})

test('repair legacy permissions manually, report skipped rooms and retry without redundant writes', async ({ browser }) => {
  const { alice, serverName } = await setupServer()
  const page = await newPage(browser)
  await login(page, alice)
  await openServer(page, serverName)

  await serverMenu(page, 'Kategorie erstellen')
  await page.getByRole('dialog').getByLabel('Kategoriename').fill('Legacy category')
  const categoryCreated = page.waitForResponse((response) => response.url().endsWith('/createRoom') && response.request().method() === 'POST')
  await page.getByRole('dialog').getByRole('button', { name: 'Kategorie erstellen' }).click()
  const { room_id: categoryId } = await (await categoryCreated).json()
  await page.getByRole('button', { name: 'Kanal in Legacy category erstellen' }).click()
  await page.getByRole('dialog').getByLabel('Kanalname').fill('legacy-channel')
  await page.getByRole('dialog').getByRole('button', { name: 'Kanal erstellen' }).click()
  await expect(page.getByRole('heading', { level: 3, name: 'legacy-channel' })).toBeVisible()
  const channelId = await page.evaluate(() => JSON.parse(localStorage.getItem('nexspeak_selection')!).channelId as string)

  // Reproduce the old shallow override, retaining custom roles and announcement/call restrictions.
  const originals = new Map<string, Record<string, unknown>>()
  for (const roomId of [categoryId, channelId]) {
    const levels = await getState(alice, roomId, 'm.room.power_levels')
    const legacy = { ...levels, events_default: 50, events: { 'org.matrix.msc3401.call.member': 50, 'm.room.message': 50 } }
    const response = await fetch(`http://localhost:8008/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.power_levels`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${alice.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(legacy),
    })
    expect(response.ok).toBe(true)
    originals.set(roomId, legacy)
  }

  let writes = 0
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().includes('/state/m.room.power_levels')) writes += 1
  })
  // One inaccessible private room must not prevent the category repair.
  let failNextRead = true
  await page.route((url) => url.pathname.replace(/\/$/, '').endsWith('/state/m.room.power_levels'), async (route) => {
    if (failNextRead && route.request().method() === 'GET' && decodeURIComponent(route.request().url()).includes(`/rooms/${channelId}/`)) {
      failNextRead = false
      await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ errcode: 'M_FORBIDDEN', error: 'Not joined' }) })
    } else {
      await route.continue()
    }
  })
  await serverMenu(page, 'Servereinstellungen')
  const repair = page.getByRole('dialog').getByRole('button', { name: 'Berechtigungen reparieren', exact: true })
  await expect(repair).toBeEnabled()
  expect(writes).toBe(0)
  expect(await getState(alice, channelId, 'm.room.power_levels')).toEqual(originals.get(channelId))

  await repair.click()
  await expect(page.getByText('Aktualisierte Räume: 1. Räume, die nicht geprüft oder repariert werden konnten: 1. Du kannst es erneut versuchen.')).toBeVisible()
  expect(writes).toBe(1)
  await expect(repair).toBeEnabled()
  await repair.click()
  await expect(page.getByText('Reparatur abgeschlossen. Aktualisierte Räume: 1.', { exact: true })).toBeVisible()
  expect(writes).toBe(2)
  for (const roomId of [categoryId, channelId]) {
    const original = originals.get(roomId)!
    expect(await getState(alice, roomId, 'm.room.power_levels')).toEqual({
      ...original, events: { ...(original.events as Record<string, number>), ...ADMIN_EVENTS },
    })
  }
  await expect(repair).toBeEnabled()
  await repair.click()
  await expect(page.getByText('Reparatur abgeschlossen. Aktualisierte Räume: 0.', { exact: true })).toBeVisible()
  expect(writes).toBe(2)
})

test('a running repair remains locked across tab changes and closing the settings', async ({ browser, request }) => {
  const alice = await registerUser('repair-tabs')
  const serverName = `Repair ${Date.now().toString(36)}`
  const { spaceId, channelIds: [roomId] } = await createSpace(alice, { name: serverName, channels: [{ name: 'legacy' }] })
  const levels = await getState(alice, roomId, 'm.room.power_levels')
  expect((await request.put(`http://localhost:8008/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.power_levels`, {
    headers: { Authorization: `Bearer ${alice.accessToken}` },
    data: { ...levels, events: { 'org.matrix.msc3401.call.member': 0 } },
  })).ok()).toBe(true)
  const page = await newPage(browser)
  await login(page, alice)
  await openServer(page, serverName)
  await serverMenu(page, 'Servereinstellungen')

  let reads = 0
  let writes = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route((url) => decodeURIComponent(url.pathname).includes(`/rooms/${roomId}/state/m.room.power_levels`), async (route) => {
    if (route.request().method() === 'GET') {
      const response = await route.fetch()
      reads += 1
      await gate
      await route.fulfill({ response })
    } else {
      if (route.request().method() === 'PUT') writes += 1
      await route.continue()
    }
  })
  const dialog = page.getByRole('dialog')
  const busy = dialog.getByRole('button', { name: 'Reparatur läuft…' })
  try {
    await dialog.getByRole('button', { name: 'Berechtigungen reparieren', exact: true }).click()
    await expect.poll(() => reads).toBe(1)
    await expect(busy).toBeDisabled()
    await dialog.getByRole('tab', { name: 'Mitglieder' }).click()
    await dialog.getByRole('tab', { name: 'Übersicht' }).click()
    await expect(busy).toBeDisabled()
    await dialog.getByRole('button', { name: 'Schließen' }).click()
    await serverMenu(page, 'Servereinstellungen')
    await expect(busy).toBeDisabled()
    expect(reads).toBe(1)
    expect(writes).toBe(0)
    release()
    await expect(page.getByText('Reparatur abgeschlossen. Aktualisierte Räume: 1.', { exact: true })).toBeVisible()
    expect(writes).toBe(1)
    const repair = dialog.getByRole('button', { name: 'Berechtigungen reparieren', exact: true })
    await expect(repair).toBeEnabled()
    await repair.click()
    await expect(page.getByText('Reparatur abgeschlossen. Aktualisierte Räume: 0.', { exact: true })).toBeVisible()
    expect(reads).toBe(2)
    expect(writes).toBe(1)
    expect(await getState(alice, spaceId, 'm.space.child', roomId)).toMatchObject({ via: ['synapse'] })
  } finally {
    release()
  }
})

test("server icon, description and roles", async ({ browser }) => {
  const { alice, bob, serverName, spaceId } = await setupServer()
  await fetch(`http://localhost:8008/_matrix/client/v3/rooms/${encodeURIComponent(spaceId)}/invite`, {
    method: "POST",
    headers: { Authorization: `Bearer ${alice.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: bob.userId }),
  })
  await fetch(`http://localhost:8008/_matrix/client/v3/join/${encodeURIComponent(spaceId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bob.accessToken}`, "Content-Type": "application/json" },
    body: "{}",
  })

  const page = await newPage(browser)
  await login(page, alice)
  await openServer(page, serverName)
  await serverMenu(page, "Servereinstellungen")
  const dialog = page.getByRole("dialog")

  await dialog.locator('input[type="file"]').setInputFiles({ name: "icon.png", mimeType: "image/png", buffer: PNG })
  await expect(dialog.getByRole("button", { name: "Entfernen" })).toBeVisible()
  await expect.poll(async () => (await getState<{ url?: string }>(alice, spaceId, "m.room.avatar"))?.url).toMatch(/^mxc:\/\//)

  await dialog.getByLabel("Beschreibung").fill("Für alle, die gerne spielen")
  await dialog.getByRole("button", { name: "Änderungen speichern" }).click()
  await expect.poll(async () => (await getState<{ topic?: string }>(alice, spaceId, "m.room.topic"))?.topic).toBe(
    "Für alle, die gerne spielen",
  )

  // Roles are power levels, applied in the server and its channels.
  await dialog.getByRole("tab", { name: "Mitglieder" }).click()
  await dialog.getByRole("combobox", { name: `Rolle von ${bob.username}` }).click()
  await page.getByRole("option", { name: "Moderator" }).click()
  await expect(page.getByText(`${bob.username} ist jetzt Moderator.`)).toBeVisible()
  const levels = await getState<{ users: Record<string, number> }>(alice, spaceId, "m.room.power_levels")
  expect(levels?.users[bob.userId]).toBe(50)

  // Legacy power levels can let moderators edit roles; the repair action remains admin-only.
  const bobPage = await newPage(browser)
  await login(bobPage, bob)
  await openServer(bobPage, serverName)
  await serverMenu(bobPage, 'Servereinstellungen')
  await expect(bobPage.getByRole('dialog').getByRole('button', { name: 'Berechtigungen reparieren' })).toHaveCount(0)

  // Kicking removes Bob from the server and its channels.
  await dialog.getByRole("button", { name: "Rauswerfen" }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Rauswerfen" }).click()
  await expect.poll(async () => (await getJoinedRoomIds(bob)).includes(spaceId)).toBe(false)

  // The new icon shows in the server list (hidden from the accessibility tree while the dialog is open).
  await dialog.getByRole("button", { name: "Schließen" }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole("navigation", { name: "Server-Liste" }).getByRole("button", { name: serverName }).locator("img")).toBeVisible()
})
