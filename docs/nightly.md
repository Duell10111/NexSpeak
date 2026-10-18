# Nightly builds

Nightly builds contain the newest changes from the development branch, usually long before they are
part of a release. They are meant for testing: expect bugs, and keep the stable app for everyday use.

Download them from the
[NexSpeak-nightly releases](https://github.com/Duell10111/NexSpeak-nightly/releases).

## How nightlies are made

- A build runs every night, but only if the app changed since the last nightly and all automated
  tests passed. Quiet days produce no new release.
- Versions look like `0.2.1-nightly.20261018.4`: the next patch version, the build date and a build
  number. Each release names the commit it was built from.
- Only the newest seven nightlies are kept.

## Next to the stable app

The nightly installs as its own app, **NexSpeak Nightly**, so you can keep both and even run them at
the same time:

- Its own name, icon entry, settings and login: signing in to the nightly doesn't touch the stable
  app, and you sign in separately.
- Its own links: `nexspeak-nightly://` instead of `nexspeak://`, so links always open the right app.
- Its own updates: the nightly updates itself to newer nightlies only; the stable app never receives
  nightlies.

Installation works like for the [stable app](install.md), including the warnings about unsigned
builds. On macOS the app is called **NexSpeak Nightly.app**, on Linux the package is
`nexspeak-nightly`.

:::{tip}
Both apps use the same Matrix account, so a new device appears for the nightly. Verify it like any
other device ([Encryption](encryption.md)) to read your encrypted messages there.
:::

## Reporting bugs

Report problems in the [issue tracker](https://github.com/Duell10111/NexSpeak/issues) and mention
the nightly version (the release title or the name of the file you installed) or the commit shown in
**Settings → About**.
