import { afterEach, describe, expect, it, vi } from "vitest"
import data from "./data.json"
import { buildSearchIndex, emojiToneMask, filterEmoji, FREQUENCY_KEY, loadFrequency, recordEmojiUse, visibleRowRange, type EmojiEntry } from "./picker"
const entries = data as unknown as EmojiEntry[]
const index = buildSearchIndex(entries)
afterEach(() => vi.unstubAllGlobals())

describe("Unicode emoji picker", () => {
  it("contains the complete Unicode 17 repertoire including joined, flag and mixed-tone emoji", () => {
    expect(entries).toHaveLength(3953)
    expect(new Set(entries.map((entry) => entry[0])).size).toBe(entries.length)
    for (const emoji of ["👍", "🫪", "🇩🇪", "👩‍🚀", "🫱🏻‍🫲🏿"]) expect(entries.some((entry) => entry[0] === emoji)).toBe(true)
  })

  it("searches English and German names and keywords with normalized punctuation and accents", () => {
    expect(filterEmoji(index, "Daumen hoch", null, 0).map((entry) => entry[0])).toContain("👍")
    expect(filterEmoji(index, "thumbs_up", null, 0).map((entry) => entry[0])).toContain("👍")
    expect(filterEmoji(index, "rakete", null, 0).map((entry) => entry[0])).toContain("🚀")
    expect(filterEmoji(index, "🤔", null, 0).map((entry) => entry[0])).toContain("🤔")
    expect(filterEmoji(index, "no-such-emoji-123", null, 0)).toHaveLength(0)
  })

  it("combines categories and search with the selected tone and exposes all variants on request", () => {
    const light = filterEmoji(index, "thumbs up", 1, 1).map((entry) => entry[0])
    expect(light).toContain("👍🏻")
    expect(light).not.toContain("👍")
    expect(light).not.toContain("👍🏿")
    expect(filterEmoji(index, "thumbs up", 3, 1)).toHaveLength(0)
    expect(filterEmoji(index, "", null, 6)).toHaveLength(entries.length)
    expect(filterEmoji(index, "", null, 0).every((entry) => emojiToneMask(entry[0]) === 0)).toBe(true)
    expect(filterEmoji(index, "", null, 1).map((entry) => entry[0])).toContain("🚀")
  })

  it("persists bounded frequency and tolerates blocked or malformed storage", () => {
    const values = new Map<string, string>()
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value) })
    values.set(FREQUENCY_KEY, "null")
    expect(loadFrequency()).toEqual({})
    values.set(FREQUENCY_KEY, JSON.stringify({ bad: "5", negative: -1, valid: 2 }))
    expect(loadFrequency()).toEqual({ valid: 2 })
    values.clear()
    recordEmojiUse(entries[0][0])
    for (const entry of entries.slice(0, 40)) recordEmojiUse(entry[0])
    expect(loadFrequency()[entries[39][0]]).toBe(1)
    recordEmojiUse(entries[0][0])
    expect(Object.keys(loadFrequency())).toHaveLength(32)
    expect(loadFrequency()[entries[0][0]]).toBe(3)
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked") }, setItem: () => { throw new Error("blocked") } })
    expect(loadFrequency()).toEqual({})
    expect(() => recordEmojiUse("👍")).not.toThrow()
  })

  it("mounts a bounded window of rows even near the end of the full dataset", () => {
    expect(visibleRowRange(0, 600)).toEqual([0, 9])
    expect(visibleRowRange(4000, 600)).toEqual([99, 108])
    expect(visibleRowRange(23960, 600)).toEqual([598, 600])
  })
})
