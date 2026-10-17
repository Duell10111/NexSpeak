import { describe, expect, it } from "vitest"
import { formattedLinks, formattedText, parseFormattedBody } from "./formatted-body"

describe("parseFormattedBody", () => {
  it("keeps allowed formatting", () => {
    expect(parseFormattedBody("<strong>bold</strong> and <em>it</em>")).toEqual([
      { tag: "strong", attrs: {}, children: ["bold"] },
      " and ",
      { tag: "em", attrs: {}, children: ["it"] },
    ])
  })

  it("drops scripts, event handlers and unsafe links", () => {
    expect(parseFormattedBody('<script>alert(1)</script><b onclick="x()">hi</b>')).toEqual([
      { tag: "b", attrs: {}, children: ["hi"] },
    ])
    expect(parseFormattedBody('<a href="javascript:alert(1)">x</a>')).toEqual([{ tag: "a", attrs: {}, children: ["x"] }])
    expect(parseFormattedBody('<a href="https://matrix.to/#/@a:b">A</a>')).toEqual([
      { tag: "a", attrs: { href: "https://matrix.to/#/@a:b" }, children: ["A"] },
    ])
  })

  it("keeps the text of unknown elements and hides the reply fallback", () => {
    expect(parseFormattedBody("<mx-reply><blockquote>old</blockquote></mx-reply><marquee>new</marquee>")).toEqual(["new"])
  })

  it("decodes entities and never turns them into markup", () => {
    expect(parseFormattedBody("&lt;b&gt;x&lt;/b&gt; &amp; &#x1F600;")).toEqual(["<b>x</b> & 😀"])
  })

  it("replaces images by their alt text", () => {
    expect(parseFormattedBody('hi <img src="mxc://a/b" alt=":wave:">')).toEqual(["hi :wave:"])
  })

  it("survives broken HTML", () => {
    expect(parseFormattedBody("<b>open <i>both")).toEqual([
      { tag: "b", attrs: {}, children: ["open ", { tag: "i", attrs: {}, children: ["both"] }] },
    ])
    expect(parseFormattedBody("a < b </i> c")).toEqual(["a < b  c"])
  })

  it("validates attributes", () => {
    expect(parseFormattedBody('<span data-mx-spoiler data-mx-color="#ff0000" style="x">s</span>')).toEqual([
      { tag: "span", attrs: { spoiler: "", color: "#ff0000" }, children: ["s"] },
    ])
    expect(parseFormattedBody('<span data-mx-color="red;background:url(x)">s</span>')).toEqual([
      { tag: "span", attrs: {}, children: ["s"] },
    ])
    expect(parseFormattedBody('<pre><code class="language-ts">x</code></pre>')).toEqual([
      { tag: "pre", attrs: {}, children: [{ tag: "code", attrs: { language: "ts" }, children: ["x"] }] },
    ])
  })

  it("collects links and text", () => {
    const tree = parseFormattedBody('hi <a href="https://matrix.to/#/@a:b">@A</a><br>there')
    expect(formattedText(tree)).toBe("hi @A\nthere")
    expect(formattedLinks(tree)).toEqual([{ text: "@A", href: "https://matrix.to/#/@a:b" }])
  })
})
