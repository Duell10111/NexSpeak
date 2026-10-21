# Third-party notices

## Unicode emoji and annotations

The emoji picker contains Unicode Emoji 17.0 and English/German CLDR 48 names and
keywords from the Unicode Consortium, distributed under the Unicode License V3
(`Unicode-3.0`). The full license is bundled at
`apps/web/public/licenses/unicode.txt` and displayed in **Settings → About**.

Sources: [Unicode Emoji 17.0](https://unicode.org/Public/17.0.0/emoji/emoji-test.txt)
and [CLDR 48](https://github.com/unicode-org/cldr/tree/release-48/common).
`apps/web/scripts/generate-emoji-data.py` reproduces the compact dataset from these
pinned sources. Glyphs are rendered by the operating system; no emoji artwork is bundled.

## Bundled soundboard sounds

`apps/web/public/sounds/celebrate.mp3`, `chime.mp3`, and `drum.mp3` are original
NexSpeak recordings synthesized from sine waves using FFmpeg. No third-party recordings,
samples, or sound libraries are included. They are distributed under the project's
AGPL-3.0-or-later license.
