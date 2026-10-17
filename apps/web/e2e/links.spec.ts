import { expect, test } from "@playwright/test"
import {
  createLoginToken,
  createPublicRoom,
  createRoom,
  HOMESERVER_URL,
  login,
  messageRow,
  newPage,
  openRoom,
  registerUser,
  sendTextAs,
} from "./helpers"

test("returning from SSO with a login token logs in", async ({ browser }) => {
  const alice = await registerUser("alice")
  const token = await createLoginToken(alice)
  const page = await newPage(browser)
  await page.goto("/login")
  // What the login page remembered before sending the browser to the identity provider.
  await page.evaluate(
    (homeserverUrl) =>
      localStorage.setItem("nexspeak_sso_pending", JSON.stringify({ homeserverUrl, startedAt: Date.now() })),
    HOMESERVER_URL,
  )

  await page.goto(`/login?loginToken=${encodeURIComponent(token)}`)
  await expect(page.getByRole("log").or(page.getByText("Wähle einen Raum aus."))).toBeVisible({ timeout: 60_000 })
  expect(new URL(page.url()).search).toBe("")
})

test("homeservers with SSO get a button that starts the login there", async ({ browser }) => {
  const page = await newPage(browser)
  // A homeserver with an identity provider (the dev stack has none).
  await page.route(`${HOMESERVER_URL}/_matrix/client/v3/login`, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          json: { flows: [{ type: "m.login.sso", identity_providers: [{ id: "oidc-test", name: "Test-IdP" }] }] },
        })
      : route.continue(),
  )
  const redirect = page.waitForRequest((request) => request.url().includes("/login/sso/redirect/"))
  await page.route("**/login/sso/redirect/**", (route) => route.fulfill({ body: "identity provider" }))

  await page.goto("/login")
  await page.getByLabel("Homeserver").fill(HOMESERVER_URL)
  await page.getByRole("button", { name: "Weiter mit Test-IdP" }).click()
  // No password form: this homeserver does not offer it.
  await expect(page.getByLabel("Passwort")).toHaveCount(0)

  const url = new URL((await redirect).url())
  expect(url.pathname).toBe("/_matrix/client/v3/login/sso/redirect/oidc-test")
  expect(url.searchParams.get("redirectUrl")).toBe("http://localhost:3100/login")
})

test("matrix.to links in messages open rooms, offer to join and start direct messages", async ({ browser }) => {
  const alice = await registerUser("alice")
  const bob = await registerUser("bob")
  const carol = await registerUser("carol")
  const suffix = Date.now().toString(36)
  const chat = `Chat ${suffix}`
  const known = `Bekannt ${suffix}`
  const chatId = await createRoom(bob, { name: chat, members: [alice] })
  const knownId = await createRoom(alice, { name: known, members: [] })
  const lobby = await createPublicRoom(carol, `Lobby ${suffix}`, `lobby-${suffix}`)

  const page = await newPage(browser)
  await login(page, alice)
  await openRoom(page, chat)

  // A room Alice is in opens directly.
  await sendTextAs(bob, chatId, `Hier: https://matrix.to/#/${knownId}`)
  await messageRow(page, "Hier:").getByRole("link").click()
  await expect(page.getByRole("heading", { level: 3, name: known })).toBeVisible()

  // A room she is not in: the join dialog, prefilled, is the confirmation.
  await openRoom(page, chat)
  await sendTextAs(bob, chatId, `Komm in die https://matrix.to/#/${encodeURIComponent(lobby.alias)}`)
  await messageRow(page, "Komm in die").getByRole("link").click()
  const joinDialog = page.getByRole("dialog")
  await expect(joinDialog.getByRole("textbox")).toHaveValue(lobby.alias)
  await joinDialog.getByRole("button", { name: "Beitreten" }).click()
  await expect(page.getByRole("heading", { level: 3, name: `Lobby ${suffix}` })).toBeVisible({ timeout: 20_000 })

  // A person without a direct message yet: confirm first.
  await openRoom(page, chat)
  await sendTextAs(bob, chatId, `Frag https://matrix.to/#/${carol.userId}`)
  await messageRow(page, "Frag").getByRole("link").click()
  const dmDialog = page.getByRole("alertdialog", { name: "Direktnachricht starten?" })
  await expect(dmDialog).toContainText(carol.userId)
  await dmDialog.getByRole("button", { name: "Nachricht schreiben" }).click()
  await expect(page.getByRole("heading", { level: 3, name: new RegExp(carol.username) })).toBeVisible({ timeout: 20_000 })
})
