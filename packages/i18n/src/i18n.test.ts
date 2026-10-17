import { describe, expect, it } from "vitest"
import { de, type MessageKey } from "./de"
import { en } from "./en"
import { getTranslator, intlLocale } from "./index"

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

describe("translations", () => {
  it("fills in placeholders", () => {
    expect(getTranslator("de")("chat.typingOne", { name: "Alice" })).toBe("Alice tippt…")
    expect(getTranslator("en")("chat.typingOne", { name: "Alice" })).toBe("Alice is typing…")
  })

  it("keeps placeholders without a value", () => {
    expect(getTranslator("en")("chat.messageTo")).toBe("Message {room}")
  })

  it("uses the same placeholders in every language", () => {
    for (const key of Object.keys(de) as MessageKey[]) {
      expect(en[key].trim(), key).not.toBe("")
      expect(placeholders(en[key]), key).toEqual(placeholders(de[key]))
    }
  })

  it("maps languages to Intl locales", () => {
    expect(intlLocale("de")).toBe("de-DE")
    expect(intlLocale("en")).toBe("en-US")
  })
})
