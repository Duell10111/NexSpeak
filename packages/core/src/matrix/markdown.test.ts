import { describe, expect, it } from "vitest"
import { markdownToHtml } from "./markdown"

describe("markdownToHtml", () => {
  it("sends no HTML for plain text", () => {
    expect(markdownToHtml("hello world")).toBeNull()
    expect(markdownToHtml("two\nlines")).toBeNull()
    expect(markdownToHtml("a < b & c")).toBeNull()
    expect(markdownToHtml("https://example.org/a_b_c*d")).toBeNull()
    expect(markdownToHtml("snake_case_name and 2 * 3 * 4")).toBeNull()
  })

  it("renders inline formatting", () => {
    expect(markdownToHtml("**bold** *it* _it_ __under__ ~~gone~~ ||secret||")).toBe(
      "<strong>bold</strong> <em>it</em> <em>it</em> <u>under</u> <del>gone</del> <span data-mx-spoiler>secret</span>",
    )
    expect(markdownToHtml("use `a **b** <c>`")).toBe("use <code>a **b** &lt;c&gt;</code>")
    expect(markdownToHtml("\\*not italic\\*")).toBe("*not italic*")
  })

  it("escapes HTML everywhere", () => {
    expect(markdownToHtml("**<script>alert(1)</script>**")).toBe("<strong>&lt;script&gt;alert(1)&lt;/script&gt;</strong>")
  })

  it("only links safe URLs", () => {
    expect(markdownToHtml("[docs](https://example.org/?a=1&b=2)")).toBe('<a href="https://example.org/?a=1&amp;b=2">docs</a>')
    expect(markdownToHtml("[x](javascript:alert(1))")).toBeNull()
  })

  it("renders blocks", () => {
    expect(markdownToHtml("# Title\n\ntext")).toBe("<h1>Title</h1><p>text</p>")
    expect(markdownToHtml("> quoted\n> more\n\nafter")).toBe("<blockquote><p>quoted<br>more</p></blockquote><p>after</p>")
    expect(markdownToHtml("- one\n- **two**")).toBe("<ul><li>one</li><li><strong>two</strong></li></ul>")
    expect(markdownToHtml("3. three\n4. four")).toBe('<ol start="3"><li>three</li><li>four</li></ol>')
    expect(markdownToHtml("```ts\nconst a = <b>\n```")).toBe('<pre><code class="language-ts">const a = &lt;b&gt;\n</code></pre>')
  })

  it("turns mentions handed in by the composer into pills", () => {
    expect(markdownToHtml("hi @Alice!", [{ text: "@Alice", href: "https://matrix.to/#/@alice:example.org" }])).toBe(
      'hi <a href="https://matrix.to/#/@alice:example.org">@Alice</a>!',
    )
    // Not inside code.
    expect(markdownToHtml("`@Alice`", [{ text: "@Alice", href: "https://matrix.to/#/@alice:example.org" }])).toBe(
      "<code>@Alice</code>",
    )
  })
})
