import { test } from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
const hook = createRequire(import.meta.url)("./build/Release/input_hook_test.node")

test("only bound down/up events allocate and wake JavaScript", { timeout: 10_000 }, async () => {
  assert.throws(() => hook.start(() => {}, 0, 0), /one push-to-talk key/)
  assert.throws(() => hook.start(() => {}, 20, 4), /one push-to-talk key/)

  for (const [keycode, button] of [[20, 0], [0, 3], [0, 4], [0, 5]]) {
    const before = hook.counters()
    const received = []
    let complete
    const delivered = new Promise((resolve) => { complete = resolve })
    hook.start((event) => {
      received.push(event)
      if (received.length === 2) complete()
    }, keycode, button)
    try {
      // A high-polling mouse, including dragging, scrolling and click synthesis.
      for (const type of [6, 9, 10, 11]) hook.dispatch(type, button, 100_000)
      for (const type of [4, 5]) hook.dispatch(type, 21, 100)
      for (const type of [7, 8]) hook.dispatch(type, button === 4 ? 5 : 4, 100)
      // Ignore the other device entirely, even if its numeric code matches the binding.
      for (const type of keycode ? [7, 8] : [4, 5]) hook.dispatch(type, keycode || button, 100)
      assert.deepEqual(hook.counters(), before)

      const types = keycode ? [4, 5] : [7, 8]
      for (const type of types) hook.dispatch(type, keycode || button, 1)
      assert.deepEqual(hook.counters(), before.map((count) => count + 2))
      await delivered
      assert.deepEqual(received.map((event) => event.type), types)
      assert.ok(received.every((event) => keycode ? event.keycode === keycode : event.button === button))
    } finally {
      hook.stop()
    }
    // Stopped hooks cannot queue anything, even when the binding still matches.
    const stopped = hook.counters()
    hook.dispatch(keycode ? 4 : 7, keycode || button, 1)
    assert.deepEqual(hook.counters(), stopped)
  }
})
