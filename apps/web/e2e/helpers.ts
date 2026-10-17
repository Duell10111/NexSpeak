import { expect, type Browser, type BrowserContextOptions, type Page } from "@playwright/test"

export const HOMESERVER_URL = "http://localhost:8008"
export const JWT_SERVICE_URL = "http://localhost:8070"
const PASSWORD = "nexspeak-e2e-password"

export interface TestUser {
  username: string
  userId: string
  password: string
  accessToken: string
}

async function api<T>(accessToken: string | null, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${HOMESERVER_URL}/_matrix/client/v3${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await response.json()
  if (!response.ok) throw new Error(`${method} ${path} failed: ${JSON.stringify(json)}`)
  return json as T
}

export async function registerUser(prefix: string): Promise<TestUser> {
  const username = `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const result = await api<{ user_id: string; access_token: string }>(null, "POST", "/register", {
    username,
    password: PASSWORD,
    auth: { type: "m.login.dummy" },
    initial_device_display_name: "e2e setup",
  })
  return { username, userId: result.user_id, password: PASSWORD, accessToken: result.access_token }
}

export async function createRoom(
  owner: TestUser,
  options: { name: string; members: TestUser[]; encrypted?: boolean; allowCalls?: boolean },
): Promise<string> {
  const { room_id: roomId } = await api<{ room_id: string }>(owner.accessToken, "POST", "/createRoom", {
    name: options.name,
    preset: "private_chat",
    invite: options.members.map((member) => member.userId),
    // Like rooms created by Element: every member may join calls.
    power_level_content_override:
      options.allowCalls === false ? undefined : { events: { "org.matrix.msc3401.call.member": 0 } },
    initial_state: options.encrypted
      ? [{ type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } }]
      : [],
  })
  for (const member of options.members) {
    await api(member.accessToken, "POST", `/join/${encodeURIComponent(roomId)}`, {})
  }
  return roomId
}

/** A space ("server") with channels; `inviteOnly` channels need an invite, the others are open to space members. */
export async function createSpace(
  owner: TestUser,
  options: { name: string; channels: Array<{ name: string; inviteOnly?: boolean }> },
): Promise<{ spaceId: string; channelIds: string[] }> {
  const serverName = owner.userId.split(":").slice(1).join(":")
  const { room_id: spaceId } = await api<{ room_id: string }>(owner.accessToken, "POST", "/createRoom", {
    name: options.name,
    preset: "private_chat",
    creation_content: { type: "m.space" },
  })
  const channelIds: string[] = []
  for (const channel of options.channels) {
    const { room_id: roomId } = await api<{ room_id: string }>(owner.accessToken, "POST", "/createRoom", {
      name: channel.name,
      preset: "private_chat",
      initial_state: channel.inviteOnly
        ? []
        : [
            {
              type: "m.room.join_rules",
              state_key: "",
              content: { join_rule: "restricted", allow: [{ type: "m.room_membership", room_id: spaceId }] },
            },
          ],
    })
    await api(owner.accessToken, "PUT", `/rooms/${encodeURIComponent(spaceId)}/state/m.space.child/${encodeURIComponent(roomId)}`, {
      via: [serverName],
    })
    channelIds.push(roomId)
  }
  return { spaceId, channelIds }
}

export async function getState<T = Record<string, unknown>>(user: TestUser, roomId: string, type: string, stateKey = ""): Promise<T | null> {
  try {
    return await api<T>(user.accessToken, "GET", `/rooms/${encodeURIComponent(roomId)}/state/${type}/${encodeURIComponent(stateKey)}`)
  } catch {
    return null
  }
}

export async function getJoinedRoomIds(user: TestUser): Promise<string[]> {
  return (await api<{ joined_rooms: string[] }>(user.accessToken, "GET", "/joined_rooms")).joined_rooms
}

export async function getDirectRooms(user: TestUser): Promise<Record<string, string[]>> {
  try {
    return await api<Record<string, string[]>>(
      user.accessToken,
      "GET",
      `/user/${encodeURIComponent(user.userId)}/account_data/m.direct`,
    )
  } catch {
    return {}
  }
}

export async function getRoomMessages(user: TestUser, roomId: string) {
  const result = await api<{ chunk: Array<{ type: string; content: Record<string, unknown> }> }>(
    user.accessToken,
    "GET",
    `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=50`,
  )
  return result.chunk
}

export async function newPage(browser: Browser, options: BrowserContextOptions = {}): Promise<Page> {
  // Contexts created by hand don't inherit `use.permissions` and `use.locale` from the config.
  const context = await browser.newContext({ permissions: ["microphone", "camera"], locale: "de-DE", ...options })
  const page = await context.newPage()
  page.on("pageerror", (error) => console.log(`[pageerror] ${error.message}`))
  if (process.env.E2E_CONSOLE) {
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") console.log(`[${message.type()}] ${message.text().slice(0, 400)}`)
    })
  }
  return page
}

/** Log in through the UI (creates a new device) and wait for the first sync. */
export async function login(page: Page, user: TestUser, loginUrl = "/login"): Promise<void> {
  await page.goto(loginUrl)
  await page.getByLabel("Homeserver").fill(HOMESERVER_URL)
  await page.getByLabel("Benutzername").fill(user.username)
  await page.getByLabel("Passwort").fill(user.password)
  await page.getByRole("button", { name: "Anmelden" }).click()
  // The main layout is shown once the initial sync completed (desktop and mobile).
  await expect(page.getByRole("log").or(page.getByText("Wähle einen Raum aus."))).toBeVisible({ timeout: 60_000 })
}

export async function openRoom(page: Page, name: string): Promise<void> {
  const sidebar = page.getByRole("button", { name: new RegExp(name) }).first()
  await expect(sidebar).toBeVisible()
  await sidebar.click()
  await expect(page.getByRole("heading", { level: 3, name })).toBeVisible()
}

export async function sendMessage(page: Page, text: string): Promise<void> {
  const composer = page.getByRole("textbox", { name: "Nachricht", exact: true })
  await expect(composer).toBeEnabled()
  await composer.fill(text)
  await composer.press("Enter")
}

/** The message whose own text (not a quoted reply) contains `text`. */
export function messageRow(page: Page, text: string) {
  return page.locator('[id^="msg-"]').filter({ has: page.getByTestId("message-body").filter({ hasText: text }) }).last()
}

/** Peak level of the remote audio on `page` over 1.5 s (0 = silence). */
export async function remoteAudioLevel(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const audio = document.querySelector("audio")
    const stream = audio?.srcObject as MediaStream | null
    if (!stream) return 0
    const context = new AudioContext()
    const analyser = context.createAnalyser()
    context.createMediaStreamSource(stream).connect(analyser)
    // Chromium's fake microphone beeps in intervals: sample long enough to catch a beep.
    const data = new Uint8Array(analyser.fftSize)
    let level = 0
    for (const end = performance.now() + 1_500; performance.now() < end; ) {
      await new Promise((resolve) => setTimeout(resolve, 20))
      analyser.getByteTimeDomainData(data)
      level = Math.max(level, Math.max(...data) - Math.min(...data))
    }
    await context.close()
    return level
  })
}

/** Sends a text message through the API (no browser needed). */
export async function sendTextAs(user: TestUser, roomId: string, body: string): Promise<void> {
  const txnId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`
  await api(user.accessToken, "PUT", `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`, {
    msgtype: "m.text",
    body,
  })
}
