import { describe, expect, it } from "vitest"
import { findMentionTrigger } from "./mentions"
import { markdownToHtml } from "./markdown"

describe("findMentionTrigger", () => {
  it("finds @ and # right before the caret", () => {
    expect(findMentionTrigger("hi @al", 6)).toEqual({ trigger: "@", query: "al", start: 3 })
    expect(findMentionTrigger("#gen", 4)).toEqual({ trigger: "#", query: "gen", start: 0 })
    expect(findMentionTrigger("hi @", 4)).toEqual({ trigger: "@", query: "", start: 3 })
  })

  it("ignores e-mail addresses and finished words", () => {
    expect(findMentionTrigger("mail me@example.org", 19)).toBeNull()
    expect(findMentionTrigger("hi @al ", 7)).toBeNull()
  })
})

describe("mention links", () => {
  it("only link whole mentions", () => {
    expect(markdownToHtml("@Alice", [{ text: "@Al", href: "https://matrix.to/#/@al:x" }])).toBeNull()
  })
})
