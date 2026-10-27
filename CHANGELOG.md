# Changelog

## [0.3.0](https://github.com/Duell10111/NexSpeak/compare/v0.2.0...v0.3.0) (2026-10-27)


### ✨ Features

* add custom status, DND and opt-in link previews ([#116](https://github.com/Duell10111/NexSpeak/issues/116)) ([fab4feb](https://github.com/Duell10111/NexSpeak/commit/fab4febb586fb7a9dfdc1023301abb2822018dea)), closes [#45](https://github.com/Duell10111/NexSpeak/issues/45)
* add message search and incoming DM call prompts ([#102](https://github.com/Duell10111/NexSpeak/issues/102)) ([f37d2fb](https://github.com/Duell10111/NexSpeak/commit/f37d2fbe69da6c9581337fa1b7f5c4b06086f5ef)), closes [#34](https://github.com/Duell10111/NexSpeak/issues/34)
* add soundboard, full emoji picker and custom server emoji ([#97](https://github.com/Duell10111/NexSpeak/issues/97)) ([208a2a2](https://github.com/Duell10111/NexSpeak/commit/208a2a255e6b7b03f84508108a01f5ef92253fff)), closes [#86](https://github.com/Duell10111/NexSpeak/issues/86)
* **calls:** add camera settings and integrate video pop-out ([#95](https://github.com/Duell10111/NexSpeak/issues/95)) ([f07cb57](https://github.com/Duell10111/NexSpeak/commit/f07cb5736dd2e636f1f34c26574cd38836209c8f))
* **calls:** enhanced noise suppression and voice activity gate ([#77](https://github.com/Duell10111/NexSpeak/issues/77)) ([ea35526](https://github.com/Duell10111/NexSpeak/commit/ea3552682c6f5dff23367ad0ecb9e062cd4fd99a)), closes [#41](https://github.com/Duell10111/NexSpeak/issues/41)
* **calls:** show call duration in the channel list ([#78](https://github.com/Duell10111/NexSpeak/issues/78)) ([5ed80b6](https://github.com/Duell10111/NexSpeak/commit/5ed80b68af22fc604847ac38f3ba380e5637981f)), closes [#29](https://github.com/Duell10111/NexSpeak/issues/29)
* **calls:** show stream viewers and play cues when someone starts or stops watching ([#115](https://github.com/Duell10111/NexSpeak/issues/115)) ([d34db19](https://github.com/Duell10111/NexSpeak/commit/d34db19a12fd25f26737a6640128947934385718)), closes [#79](https://github.com/Duell10111/NexSpeak/issues/79)
* **calls:** sound cues for join, leave and screensharing ([#76](https://github.com/Duell10111/NexSpeak/issues/76)) ([18c49da](https://github.com/Duell10111/NexSpeak/commit/18c49dafc6017d8fc04e5fd661dc4526c8163647)), closes [#79](https://github.com/Duell10111/NexSpeak/issues/79)
* **chat:** add Matrix sticker support ([#98](https://github.com/Duell10111/NexSpeak/issues/98)) ([468e2f3](https://github.com/Duell10111/NexSpeak/commit/468e2f3642e5a13520c7e6906ea83dd198d1808a)), closes [#51](https://github.com/Duell10111/NexSpeak/issues/51)
* **chat:** add polls, inline media playback and quick switcher ([#101](https://github.com/Duell10111/NexSpeak/issues/101)) ([398968e](https://github.com/Duell10111/NexSpeak/commit/398968e5f74b5b8ec439093aa93520b28a7077d7)), closes [#38](https://github.com/Duell10111/NexSpeak/issues/38) [#44](https://github.com/Duell10111/NexSpeak/issues/44) [#42](https://github.com/Duell10111/NexSpeak/issues/42)
* **chat:** GIF picker with KLIPY search, favourites and visibility-gated playback ([#120](https://github.com/Duell10111/NexSpeak/issues/120)) ([53ad7c7](https://github.com/Duell10111/NexSpeak/commit/53ad7c7b2c177afa1690da6b9d1a2213ffe1bad7)), closes [#27](https://github.com/Duell10111/NexSpeak/issues/27)
* **desktop:** add configurable global call shortcuts ([#80](https://github.com/Duell10111/NexSpeak/issues/80)) ([8321ebc](https://github.com/Duell10111/NexSpeak/commit/8321ebcf75b400a77060844b4d949c60924cdac1)), closes [#35](https://github.com/Duell10111/NexSpeak/issues/35)
* **desktop:** share system audio on macOS with a remembered toggle ([#81](https://github.com/Duell10111/NexSpeak/issues/81)) ([e78aff8](https://github.com/Duell10111/NexSpeak/commit/e78aff8da9b7e9f29bf381c088127a886427a114)), closes [#36](https://github.com/Duell10111/NexSpeak/issues/36)
* **server:** custom, stackable roles on top of power levels ([#83](https://github.com/Duell10111/NexSpeak/issues/83)) ([85f5463](https://github.com/Duell10111/NexSpeak/commit/85f5463078f72264a9358dfd04f2b2d8c700e47a)), closes [#32](https://github.com/Duell10111/NexSpeak/issues/32)
* **server:** granular permissions with category and channel sync ([#82](https://github.com/Duell10111/NexSpeak/issues/82)) ([81d6edb](https://github.com/Duell10111/NexSpeak/commit/81d6edbce46653ded381cb60997e77794e79876f)), closes [#33](https://github.com/Duell10111/NexSpeak/issues/33)
* **soundboard:** new default sounds, Discord-like replay and redesigned picker ([#113](https://github.com/Duell10111/NexSpeak/issues/113)) ([4825653](https://github.com/Duell10111/NexSpeak/commit/482565307263c37a20ac13c11cc5d59c47b76c34))


### 🐛 Bugfixes

* **audio:** avoid microphone capture when listing devices ([#103](https://github.com/Duell10111/NexSpeak/issues/103)) ([1fb7242](https://github.com/Duell10111/NexSpeak/commit/1fb724241c0499fe9895fd25eea9f6b87a18078b)), closes [#94](https://github.com/Duell10111/NexSpeak/issues/94)
* **calls:** avoid redundant service discovery on join ([#99](https://github.com/Duell10111/NexSpeak/issues/99)) ([7f6b630](https://github.com/Duell10111/NexSpeak/commit/7f6b63066340cf775ff3d08a6cb7e7a4035e4992)), closes [#92](https://github.com/Duell10111/NexSpeak/issues/92)
* **calls:** stabilize speaking feedback and live microphone testing ([#96](https://github.com/Duell10111/NexSpeak/issues/96)) ([470c3b3](https://github.com/Duell10111/NexSpeak/commit/470c3b35f109ec4afa2fbc7b85536518cf4dd19d)), closes [#94](https://github.com/Duell10111/NexSpeak/issues/94)
* correct chat drafts, permissions, previews, notifications and session caching ([#106](https://github.com/Duell10111/NexSpeak/issues/106)) ([5733b11](https://github.com/Duell10111/NexSpeak/commit/5733b112eebcceffe0dc42d755c43eb1bc048b65)), closes [#109](https://github.com/Duell10111/NexSpeak/issues/109) [#110](https://github.com/Duell10111/NexSpeak/issues/110)
* **web:** keep the newest security status when reads finish out of order ([#85](https://github.com/Duell10111/NexSpeak/issues/85)) ([07d04fb](https://github.com/Duell10111/NexSpeak/commit/07d04fbc7b024bdf7691b0a2ba998c30a10e77bc)), closes [#84](https://github.com/Duell10111/NexSpeak/issues/84)
* **web:** keep the page clickable after closing a dialog opened from a menu ([#87](https://github.com/Duell10111/NexSpeak/issues/87)) ([2d14286](https://github.com/Duell10111/NexSpeak/commit/2d14286f674fa19cec7d5753d348c5034f8826c1)), closes [#86](https://github.com/Duell10111/NexSpeak/issues/86)


### 🔧 Chore

* **deps:** update stable dependencies and fix reaction popup anchoring ([#89](https://github.com/Duell10111/NexSpeak/issues/89)) ([5240597](https://github.com/Duell10111/NexSpeak/commit/52405970dee843ae73cacc21d4318daa86a2198b)), closes [#90](https://github.com/Duell10111/NexSpeak/issues/90)


### 🚀 Continuous Integration

* stop the CLA action from locking merged pull requests ([94ec9e5](https://github.com/Duell10111/NexSpeak/commit/94ec9e594d69546e0fe999837df9253907c0b4dc))


### 📄 Documentation

* add app screenshots to user documentation ([#118](https://github.com/Duell10111/NexSpeak/issues/118)) ([a963547](https://github.com/Duell10111/NexSpeak/commit/a963547ab1976a1bcd6bc5f32642f743c5d449cd)), closes [#117](https://github.com/Duell10111/NexSpeak/issues/117)
* **calls:** define server enforcement prerequisites for voice moderation ([#91](https://github.com/Duell10111/NexSpeak/issues/91)) ([f158e44](https://github.com/Duell10111/NexSpeak/commit/f158e44f31e0f884f7061e9d658738842d8c0790))
* update documentation for self-hosting a Matrix homeserver ([9de827a](https://github.com/Duell10111/NexSpeak/commit/9de827ad21c3998c76150f5453d789f3eb0579f6))

## [0.2.0](https://github.com/Duell10111/NexSpeak/compare/v0.1.0...v0.2.0) (2026-10-19)


### ✨ Features

* create servers from inside the app ([#67](https://github.com/Duell10111/NexSpeak/issues/67)) ([499d355](https://github.com/Duell10111/NexSpeak/commit/499d355ea56c51fad02b591960ac1620b503b7df)), closes [#31](https://github.com/Duell10111/NexSpeak/issues/31)
* friends list with requests and presence dots ([#69](https://github.com/Duell10111/NexSpeak/issues/69)) ([8253453](https://github.com/Duell10111/NexSpeak/commit/825345367f5c5c84117a302d986e83b1d408a074)), closes [#21](https://github.com/Duell10111/NexSpeak/issues/21)
* leave direct messages and rooms outside a server ([#72](https://github.com/Duell10111/NexSpeak/issues/72)) ([8e338b3](https://github.com/Duell10111/NexSpeak/commit/8e338b325e629b6acddbd2cb13c8cdb7e26a7b42)), closes [#70](https://github.com/Duell10111/NexSpeak/issues/70)
* monorepo, Beta 0.1 web features and the desktop app ([#1](https://github.com/Duell10111/NexSpeak/issues/1)) ([3067a5a](https://github.com/Duell10111/NexSpeak/commit/3067a5acd89aa3fb3c9bbf8701d265ef948402e8))
* opt-in "Watch stream", pausable stream preview and "Check for updates" ([#30](https://github.com/Duell10111/NexSpeak/issues/30)) ([e16b81b](https://github.com/Duell10111/NexSpeak/commit/e16b81ba2449ba41974b55c35bf8d8f9caa83fd5)), closes [#28](https://github.com/Duell10111/NexSpeak/issues/28)


### 🐛 Bugfixes

* **ci:** nightly installer names for auto-update, clearer CI status ([#15](https://github.com/Duell10111/NexSpeak/issues/15)) ([ced3943](https://github.com/Duell10111/NexSpeak/commit/ced3943435fc0502ea17faf42ee03f62e1d021f6)), closes [#11](https://github.com/Duell10111/NexSpeak/issues/11)
* **desktop:** build on macOS and Linux in CI ([#14](https://github.com/Duell10111/NexSpeak/issues/14)) ([febcd75](https://github.com/Duell10111/NexSpeak/commit/febcd7593da1c3b67c8072bb1e7e39ccca9807d0)), closes [#13](https://github.com/Duell10111/NexSpeak/issues/13)
* **desktop:** permissions and navigation under app:// ([3067a5a](https://github.com/Duell10111/NexSpeak/commit/3067a5acd89aa3fb3c9bbf8701d265ef948402e8))
* keep channel and category security settings admin-only ([#73](https://github.com/Duell10111/NexSpeak/issues/73)) ([aa5ca55](https://github.com/Duell10111/NexSpeak/commit/aa5ca55596e21c7045a0ce31fbc4f11e0893eec3)), closes [#66](https://github.com/Duell10111/NexSpeak/issues/66)
* **web:** settings dialog no longer scrolls sideways or jumps between tabs ([#25](https://github.com/Duell10111/NexSpeak/issues/25)) ([81b135e](https://github.com/Duell10111/NexSpeak/commit/81b135eec7f2e7f123fa92b89cc78a0f9bc21169)), closes [#23](https://github.com/Duell10111/NexSpeak/issues/23)


### 🔧 Chore

* add discord clone template ([fda4406](https://github.com/Duell10111/NexSpeak/commit/fda4406f1d27c1e563927ba39bb578053ec2c358))


### ⚡️ Performance

* **desktop:** filter push-to-talk input natively ([#68](https://github.com/Duell10111/NexSpeak/issues/68)) ([8bd690e](https://github.com/Duell10111/NexSpeak/commit/8bd690eb1d989803954a37c2d87f3a829da4a9a8)), closes [#74](https://github.com/Duell10111/NexSpeak/issues/74)


### 📄 Documentation

* plan 0.3–0.5 issues, in-app server creation and the 1.0 milestone ([#48](https://github.com/Duell10111/NexSpeak/issues/48)) ([ae121c0](https://github.com/Duell10111/NexSpeak/commit/ae121c04efebef6e11aa6f33ff25a39bdf7bac81))
* plan calls, friends list, soundboard and GIF features ([#24](https://github.com/Duell10111/NexSpeak/issues/24)) ([8422ae6](https://github.com/Duell10111/NexSpeak/commit/8422ae6af4df6cdcd69eba2783989d8b9860a0ef)), closes [#19](https://github.com/Duell10111/NexSpeak/issues/19) [#20](https://github.com/Duell10111/NexSpeak/issues/20) [#21](https://github.com/Duell10111/NexSpeak/issues/21) [#22](https://github.com/Duell10111/NexSpeak/issues/22) [#26](https://github.com/Duell10111/NexSpeak/issues/26) [#27](https://github.com/Duell10111/NexSpeak/issues/27) [#28](https://github.com/Duell10111/NexSpeak/issues/28) [#29](https://github.com/Duell10111/NexSpeak/issues/29)
* plan leaving direct messages and rooms outside a server ([#71](https://github.com/Duell10111/NexSpeak/issues/71)) ([86a915a](https://github.com/Duell10111/NexSpeak/commit/86a915a228ecaeea98498a09e3ebf63d22e73750)), closes [#70](https://github.com/Duell10111/NexSpeak/issues/70)
* user documentation is published on Read the Docs ([#18](https://github.com/Duell10111/NexSpeak/issues/18)) ([188e584](https://github.com/Duell10111/NexSpeak/commit/188e584bf2146351b1b43a5503196d4dd8ddaeac)), closes [#16](https://github.com/Duell10111/NexSpeak/issues/16)
* user documentation on Read the Docs, nightly builds done ([#17](https://github.com/Duell10111/NexSpeak/issues/17)) ([70bbf15](https://github.com/Duell10111/NexSpeak/commit/70bbf15bec61a18e18bcbec22bab535f13ffa82a)), closes [#11](https://github.com/Duell10111/NexSpeak/issues/11) [#16](https://github.com/Duell10111/NexSpeak/issues/16)
