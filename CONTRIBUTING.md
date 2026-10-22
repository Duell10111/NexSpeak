# Contributing to NexSpeak

Thanks for helping out! Setup, commands and the local homeserver are described in the
[README](README.md); project rules (performance first, i18n, server model) are in
[AGENTS.md](AGENTS.md).

## Contributor License Agreement

Before your first pull request can be merged, you need to sign the [CLA](CLA.md) once. A bot
comments on your pull request; reply with the sentence it asks for. You keep the copyright in
your work. The CLA lets the project be distributed in app stores, whose terms conflict with the
AGPL on its own.

## Guidelines

- **Performance first:** NexSpeak runs next to games. Nothing may cost CPU, GPU or memory while
  idle (no polling, no timers, no running animations). See AGENTS.md.
- **English everywhere except the UI:** code, comments, identifiers, log messages, test names,
  commit messages, pull requests, issues and documentation are written in English. German exists
  only as a UI language.
- **UI texts** are never hard-coded: add a key to `packages/i18n/src/de.ts` and `en.ts`.
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `perf:`, `chore:`, …).
- **Dependencies** must be compatible with the AGPL-3.0 and worth their weight.
- Before opening a pull request: `npm run lint`, `npm test`, `npm run build`. Changes to calls also
  need the end-to-end tests (`npm run test:e2e:docker`). CI runs all of these on every pull request
  (`.github/workflows/ci.yml`, `.github/workflows/e2e.yml`).

## Dependency updates

Use stable releases and keep shared Matrix/LiveKit versions aligned between web and core, and
Next.js aligned with `eslint-config-next`. Node types follow the project's Node 24 runtime.
TypeScript stays on 6.0.3 until typescript-eslint supports the TypeScript 7 API; ESLint stays on
9.39.5 until the React, accessibility and import plugins used by Next.js support ESLint 10.
Electron Builder and Updater publish newer stable maintenance releases under their `v26` npm tag.

Check `npm ls --all` for peer conflicts and run `npm audit --omit=dev` separately from the full
audit. The full audit can still report unresolved upstream issues in build and lint dependencies;
do not use `npm audit fix --force` to downgrade Next.js or the desktop packager.

## Documentation screenshots

Screenshots in `docs/images/` show the real English UI with sample accounts on the local development
homeserver. Refresh them after changes to the pictured UI:

```bash
nvm use
docker compose -f dev/docker-compose.yml --profile e2e up -d
npm run build
PORT=3100 node apps/web/scripts/serve.mjs
```

In a second terminal, from the repository root:

```bash
E2E_BROWSER_WS=ws://localhost:3030/ node apps/web/scripts/capture-docs-screenshots.mjs
.venv/bin/sphinx-build -W docs docs/_build/html
```

Create the documentation virtual environment first if needed, using
`python3 -m venv .venv` and `.venv/bin/pip install -r docs/requirements.txt`.
The capture script creates a temporary server and sample users, uses fake media devices for the
voice call, and closes its browser contexts and deactivates its accounts when finished. It only
connects to the local app and homeserver. Without `E2E_BROWSER_WS`, it uses a locally installed
Playwright Chromium (`npx playwright install chromium` from `apps/web`). Review every image for
readability, clipping and accidental personal data before committing. Keep captions and alternative
text in the matching documentation pages in sync with the images.

## License

NexSpeak is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE).
