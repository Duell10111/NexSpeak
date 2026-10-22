// Capture the real app against the development stack, without personal accounts or mock UI.
// See CONTRIBUTING.md for setup. This is an opt-in contributor tool, never part of the app build.
import { mkdir } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import { chromium, expect } from "@playwright/test"

const appUrl = "http://localhost:3100"
const homeserver = "http://localhost:8008"
const output = fileURLToPath(new URL("../../../docs/images/", import.meta.url))
const password = randomUUID()
const runId = Date.now().toString(36)
const users = []

async function api(user, method, path, body) {
  const response = await fetch(`${homeserver}/_matrix/client/v3${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(user ? { Authorization: `Bearer ${user.access_token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}`)
  return response.json()
}

async function register(name) {
  const username = `docs-${name.toLowerCase()}-${runId}`
  const user = await api(null, "POST", "/register", {
    username, password, auth: { type: "m.login.dummy" }, initial_device_display_name: "Documentation setup",
  })
  users.push(user)
  await api(user, "PUT", `/profile/${encodeURIComponent(user.user_id)}/displayname`, { displayname: name })
  return { ...user, username }
}

async function createRoom(owner, name, members, space = false) {
  const { room_id: id } = await api(owner, "POST", "/createRoom", {
    name, preset: "private_chat", invite: members.map((user) => user.user_id),
    ...(space ? { creation_content: { type: "m.space" } } : {}),
    power_level_content_override: { events: { "org.matrix.msc3401.call.member": 0 } },
  })
  for (const member of members) await api(member, "POST", `/join/${encodeURIComponent(id)}`, {})
  return id
}

async function state(owner, room, type, content, key = "") {
  return api(owner, "PUT", `/rooms/${encodeURIComponent(room)}/state/${type}/${encodeURIComponent(key)}`, content)
}

async function send(user, room, type, content) {
  return api(user, "PUT", `/rooms/${encodeURIComponent(room)}/send/${type}/${randomUUID()}`, content)
}

async function capture(page, name, locator = page) {
  await page.mouse.move(0, 0)
  await page.evaluate(() => document.fonts.ready)
  await locator.screenshot({ path: `${output}${name}.png`, animations: "disabled", caret: "hide" })
  console.log(`Captured ${name}.png`)
}

async function login(browser, user, room, space) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
    locale: "en-GB", timezoneId: "UTC", colorScheme: "dark",
    permissions: ["microphone", "camera"],
  })
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)
  await page.addInitScript(({ room, space }) => {
    localStorage.setItem("nexspeak:locale", "en")
    localStorage.setItem("nexspeak_selection", JSON.stringify({ serverId: space, channelId: room }))
  }, { room, space })
  await page.goto(`${appUrl}/login`)
  await page.getByLabel("Homeserver", { exact: true }).fill(homeserver)
  await page.getByLabel("Username", { exact: true }).fill(user.username)
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(page.getByRole("heading", { level: 3, name: "general", exact: true })).toBeVisible({ timeout: 60_000 })
  return page
}

await mkdir(output, { recursive: true })
const launchOptions = { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] }
const browser = process.env.E2E_BROWSER_WS
  ? await chromium.connect(process.env.E2E_BROWSER_WS, {
    exposeNetwork: "<loopback>",
    // Same launch-options header used by Playwright's remote-browser test fixture.
    headers: { "x-playwright-launch-options": JSON.stringify(launchOptions) },
  })
  : await chromium.launch(launchOptions)
try {
  const alice = await register("Alice")
  const bob = await register("Bob")
  const charlie = await register("Charlie")
  const members = [bob, charlie]
  const space = await createRoom(alice, "Weekend crew", members, true)
  const category = await createRoom(alice, "Community", members, true)
  await state(alice, space, "m.space.child", { via: ["synapse"], order: "a" }, category)
  const rooms = []
  for (const [index, name] of ["general", "game-night", "clips-and-highlights"].entries()) {
    const room = await createRoom(alice, name, members)
    await state(alice, category, "m.space.child", { via: ["synapse"], order: String(index) }, room)
    rooms.push(room)
  }
  const general = rooms[0]
  await state(alice, general, "m.room.topic", { topic: "Good games, good company. Plan the next session here." })
  await send(alice, general, "m.room.message", {
    msgtype: "m.text", body: "Welcome to the Weekend crew! A place to chat, play and hang out.",
    format: "org.matrix.custom.html", formatted_body: "Welcome to the <strong>Weekend crew!</strong> A place to chat, play and hang out.",
  })
  const { event_id: plan } = await send(bob, general, "m.room.message", {
    msgtype: "m.text", body: "Game night on Friday? I can be online at 19:00 UTC.",
  })
  for (const user of [alice, charlie]) await send(user, general, "m.reaction", {
    "m.relates_to": { rel_type: "m.annotation", event_id: plan, key: "🎮" },
  })
  await send(charlie, general, "m.room.message", { msgtype: "m.text", body: "Count me in! Let's pick a co-op game this time." })
  await send(alice, general, "m.room.message", { msgtype: "m.text", body: "Sounds good. We can use the voice channel here while we play." })
  for (const [user, body] of [[alice, "How about a co-op adventure?"], [bob, "Perfect! I'll bring a few suggestions on Friday."]]) {
    await send(user, general, "m.room.message", {
      msgtype: "m.text", body,
      "m.relates_to": { rel_type: "m.thread", event_id: plan, is_falling_back: true, "m.in_reply_to": { event_id: plan } },
    })
  }
  await state(alice, general, "m.room.pinned_events", { pinned: [plan] })

  const page = await login(browser, alice, general, space)
  await expect(page.getByText("Count me in! Let's pick a co-op game this time.", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Weekend crew", exact: true }).first()).toBeVisible()
  await capture(page, "server-chat")

  await page.getByRole("button", { name: "Open thread: 2 replies", exact: true }).click()
  await expect(page.getByText("How about a co-op adventure?", { exact: true })).toBeVisible()
  await capture(page, "chat-thread")
  await page.getByRole("complementary", { name: "Thread", exact: true }).getByRole("button", { name: "Close", exact: true }).click()

  await page.getByRole("button", { name: "Settings", exact: true }).click()
  const settings = page.getByRole("dialog", { name: "Settings", exact: true })
  await expect(settings.getByRole("combobox", { name: "Input device (microphone)", exact: true })).toBeVisible()
  await capture(page, "audio-settings", settings)
  await page.keyboard.press("Escape")

  const bobPage = await login(browser, bob, general, space)
  for (const participant of [page, bobPage]) {
    await participant.getByRole("button", { name: "Join voice channel", exact: true }).click()
    await expect(participant.getByRole("button", { name: "Leave call", exact: true })).toBeVisible({ timeout: 60_000 })
  }
  await expect(page.getByTestId("call-tile")).toHaveCount(2)
  await page.getByRole("button", { name: "Show chat", exact: true }).click()
  await expect(page.getByRole("complementary", { name: "Chat", exact: true })).toBeVisible()
  await capture(page, "voice-call")

  // A fresh context keeps the login screenshot free of account details and passwords.
  const loginContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-GB", colorScheme: "dark" })
  const loginPage = await loginContext.newPage()
  await loginPage.goto(`${appUrl}/login`)
  await loginPage.getByLabel("Homeserver", { exact: true }).fill(homeserver)
  await expect(loginPage.getByLabel("Username", { exact: true })).toBeVisible()
  await capture(loginPage, "sign-in")
} finally {
  // Release all calls/microphones even when a capture fails. Remove only these sample accounts.
  await browser.close()
  for (const user of users) {
    await api(user, "POST", "/account/deactivate", {
      auth: { type: "m.login.password", identifier: { type: "m.id.user", user: user.user_id }, password },
      erase: true,
    }).catch((error) => console.error(`Sample account cleanup failed: ${error.message}`))
  }
}
