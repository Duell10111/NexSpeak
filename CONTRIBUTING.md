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
  need the end-to-end tests (`npm run test:e2e:docker`).

## License

NexSpeak is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE).
