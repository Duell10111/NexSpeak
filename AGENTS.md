# AGENTS.md

Notes for AI agents and contributors working on NexSpeak (a Discord-like Matrix client with
MatrixRTC/LiveKit calls).

## Top priority: performance

NexSpeak runs next to games. Every bit of CPU, GPU and memory we use is taken from the game.
**Using as few resources as possible matters for every change**: when in doubt, the leaner
solution wins over a convenience feature. New features must cost practically nothing while idle
(window in the background, no call).

### Media (calls, camera, screen sharing)

- **Video is encoded with H.264** (`packages/core/src/video-codec.ts`, `publishDefaults` in
  `packages/core/src/matrix/call-session.ts`). H.264 is the codec every target platform encodes
  in hardware:
  - macOS: VideoToolbox (Apple Silicon and Intel)
  - Windows with NVIDIA: NVENC, with AMD: AMF, with Intel: Quick Sync (all via Media Foundation)
  - Linux: VA-API, in Chromium only with `--enable-features=AcceleratedVideoEncoder` or
    `VaapiVideoEncoder`. The desktop app sets these flags (`apps/desktop/src/main.ts`); never
    disable hardware acceleration.

  Two traps that otherwise silently fall back to software encoding (`packages/core/src/video-codec.ts`):
  - LiveKit only negotiates H.264 Constrained Baseline, but Chrome on macOS encodes that profile
    in software only. The sending connection therefore uses Main locally under the same payload
    type number (`installH264MainProfilePreference`); do not remove it.
  - Hardware encoders reject odd frame sizes (e.g. a 1728×1117 window). Screen sharing therefore
    scales down minimally to even dimensions (`evenScale`).

  Check on a machine with a GPU: `cd apps/web && E2E_HARDWARE=1 npx playwright test hardware-encoding`
  (local Chrome, not the Docker browsers).

  Firefox always encodes H.264 in software (OpenH264, at least on macOS) and reports neither the
  encoder nor a CPU limit in its stats; the UI points this out there and detects overload via the
  encode time per frame. Without a hardware encoder the browser itself falls back to software
  H.264 (OpenH264). VP8 only when H.264 is not available at all. Do not introduce another codec
  (VP9, AV1) as the default until every target platform encodes it in hardware.
- **Every simulcast layer is a separate encoder** – with hardware encoding also a separate encoder
  session (NVIDIA consumer cards allow only a few concurrent sessions, shared with game recording
  tools). Hence at most two layers per video track (camera: original + 360p, screen: original +
  half resolution). No additional layers without a good reason.
- Quality comes from the user's settings (`packages/core/src/screenshare-quality.ts`), not from
  fixed high values. Encode nothing nobody watches: `dynacast` and `adaptiveStream` stay enabled.
- No image processing on the main thread (canvas copies, filters, custom frame loops). If
  something has to happen per frame, do it in a worker (like the E2EE encryption).
- Whether encoding really happens in hardware is shown in the stream menu during a call (WebRTC
  stats `powerEfficientEncoder`/`encoderImplementation`). Check there after changing encoding.

### UI

- No polling while the data is not visible (see `EncoderStatus` in `call-area.tsx`: stats only
  while the menu is open). Prefer subscribing to events of the Matrix SDK or LiveKit.
- Batch frequent events (speaking indicator, member lists, typing), e.g. with
  `requestAnimationFrame` as in `useRtcCallInfo`, instead of re-rendering on every event.
- No permanently running animations and no timers while idle.
- New dependencies only when they are worth their weight; no big libraries for small things.

## Project

- Monorepo with npm workspaces:
  - `apps/web` – Next.js app (UI, hooks, E2E tests); `@/` points to `apps/web/src`.
  - `apps/desktop` – Electron shell around the web build, no UI code of its own. Desktop features
    go through `window.nexspeak` (contract: `packages/core/src/desktop-bridge.ts`, in the web app
    via `desktopBridge()` from `@/lib/desktop`); the bridge is missing in the browser, so always
    check for it. The renderer stays sandboxed without Node; at runtime the preload script may
    only import `electron`. Never disable hardware acceleration. Global input hooks (push to
    talk) only run during a call that needs them – they see every key and mouse move. Compare
    origins with `originOf()` (`apps/desktop/src/origin.ts`), never `URL.origin`: Node returns
    `"null"` for `app://`.
  - `apps/mobile` – Expo app (planned).
  - `packages/core` (`@nexspeak/core/...`) – Matrix and call logic without UI; never imports from
    `apps/`. Direct browser APIs only where there is no alternative (yet).
  - `packages/i18n` (`@nexspeak/i18n`) – dictionaries and `t()`.
  Packages ship TypeScript sources directly (no build step of their own).
- The web app is a **static export** (`output: "export"` → `apps/web/out/`), which the desktop
  app loads as well. No Next.js server features: no API routes, server actions, middleware,
  `headers()`/cookies, image optimization or dynamic routes without `generateStaticParams`.
  Security headers live in `apps/web/security-headers.json` (hosting: `docs/hosting.md`).
- Node 24 (`.nvmrc`). Commands in the root: `npm run dev`, `npm run build`, `npm run lint`,
  `npm run typecheck`, `npm test` (Vitest across all workspaces), `npm run test:e2e:docker`
  (Playwright against `dev/docker-compose.yml`). Desktop: `npm run dev:desktop`,
  `npm run test:e2e:desktop`, `npm run dist:desktop`. Install dependencies with
  `-w <workspace>`, e.g. `npm install foo -w @nexspeak/web`.
- Import values (not just types) from subdirectories of `matrix-js-sdk` by their full path
  (`matrix-js-sdk/lib/matrixrtc/index.js`), otherwise Next.js cannot load the SDK as an external
  package ("Package matrix-js-sdk can't be external").
- The UI exists in German and English (`packages/i18n`, no library). Never hard-code new texts
  in components; add keys to `de.ts` (reference) and `en.ts`; use `useTranslation()` in
  components and `t()` outside React. Without a saved choice the language follows the browser.
  The E2E tests run with `locale: "de-DE"` against the German UI.
- Check changes to calls with the E2E tests in `apps/web/e2e/call.spec.ts` (including E2EE).
- **User documentation** lives in `docs/` (Sphinx with MyST Markdown, the Furo theme, published on
  Read the Docs via `.readthedocs.yaml`; `beta-plan.md` is excluded). When a change alters what users
  see or do, update the matching page and use the English UI labels from `en.ts`. Check with
  `python3 -m venv .venv && .venv/bin/pip install -r docs/requirements.txt` and
  `.venv/bin/sphinx-build -W docs docs/_build/html` (warnings fail the Read the Docs build).
- **English everywhere except the UI:** code, comments, identifiers, log and error messages for
  developers, test names, commit messages, pull requests, issues, milestones, labels and all
  documentation (README, `docs/`, AGENTS.md). German exists only as a UI language (`de.ts`).
- License: AGPL-3.0-or-later (`LICENSE`). New dependencies must be compatible with it (MIT, ISC,
  BSD, Apache-2.0, MPL-2.0, (A)GPL-3.0 – no proprietary or "non-commercial" licenses). External
  contributions need a signed CLA (`CLA.md`).

## Issues, milestones and labels

Work is planned on GitHub (`Duell10111/NexSpeak`) in milestones; `docs/beta-plan.md` mirrors them
as checklists. List the milestones with
`gh api 'repos/{owner}/{repo}/milestones?state=all' --jq '.[] | "\(.number) \(.state) \(.title): \(.description)"'`.

- **Every issue belongs to exactly one milestone.** Pick the open milestone whose description
  covers the scope (e.g. `Beta 0.2 – Desktop` for the Electron app, `0.3` for features after the
  betas, `Mobile Alpha` for `apps/mobile`).
- **Create a milestone only if no open one fits**, e.g. a new release or platform. Title: the
  version, optionally with the focus (`Beta 0.3 – Calls`, `0.4`); description: one English sentence
  listing the scope. Add it to `docs/beta-plan.md` (section 4 and the milestone list in section 5)
  and mention the new milestone to the user.
- **Before working on a feature or bug, look for its issue** (`gh issue list --search …`). If there
  is none, create one with milestone and labels, e.g.
  `gh issue create --milestone "Beta 0.2 – Desktop" --label type:feature,area:desktop`.
- **Labels:** exactly one `type:` (`type:feature`, `type:bug`, `type:chore`), at least one `area:`
  (`area:web`, `area:desktop`, `area:core`, `area:calls`, `area:mobile`, `area:repo`); add `perf`
  for CPU/GPU/memory/idle cost and `needs-decision` when the maintainer has to decide something.
  No new labels without asking.
- **Reference issues** in commits and PRs (`Closes #7`, or `Refs #9` if the issue stays open) and
  tick the matching checkbox in `docs/beta-plan.md` in the same commit.
- Do not close or delete milestones and do not move issues between milestones on your own; that is
  the maintainer's call.

## Server model (Discord → Matrix)

Like Element, so both clients see the same structure (`packages/core/src/matrix/server.ts`):

- Server = space, category = sub-space, channel = room (text and voice at once).
- Order = `order` in `m.space.child` (`packages/core/src/matrix/space-order.ts`). Moving writes
  as few events as possible (ideally one), because real homeservers rate-limit events heavily.
- Open channel = join rule `restricted` to the server; private channel = `invite`.
  Server invites never invite into private channels.
- Roles = power levels (admin 100, moderator 50, member 0), set server-wide in all rooms.
  Icons = `m.room.avatar`, description/topic = `m.room.topic`.
- Rooms cannot be deleted in Matrix: "Delete" removes the channel from the server, kicks all
  members and leaves it.
- New channels/categories of the joined server are joined automatically, but only when the
  structure changes (no polling).
