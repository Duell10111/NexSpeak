/**
 * Markdown for outgoing messages → Matrix `formatted_body` (org.matrix.custom.html). A small,
 * dependency-free subset, Discord flavoured:
 *
 *   **bold**  *italic* / _italic_  __underline__  ~~strike~~  ||spoiler||  `code`
 *   ```lang fenced code```  > quote  - / 1. lists  # headings  [text](https://…)  \escape
 *
 * The plain `body` stays the markdown source, like Element does. Mentions are links handed in by
 * the composer (they become matrix.to pills); bare URLs stay text, the receiving client links them.
 */

export interface MarkdownLink {
  /** Text in the message that becomes the link, e.g. "@Alice". */
  text: string
  href: string
}

export interface MarkdownEmoji { text: string; url: string }

const SAFE_HREF = /^(https?:\/\/|mailto:)/i
// Private-use characters as placeholder delimiters; stripped from the input first.
const PH_OPEN = ''
const PH_CLOSE = ''
const PLACEHOLDER = /(\d+)/g
const URL_PATTERN = /https?:\/\/[^\s<]+[^\s<.,:;"')\]!?*_~|]/g

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

class InlineRenderer {
  private readonly saved: string[] = []

  constructor(private readonly links: MarkdownLink[], private readonly emojis: MarkdownEmoji[] = []) {}

  private hold(html: string): string {
    this.saved.push(html)
    return `${PH_OPEN}${this.saved.length - 1}${PH_CLOSE}`
  }

  render(source: string): string {
    let text = source

    // Code spans first: nothing inside them is markdown.
    text = text.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_match, _ticks: string, code: string) =>
      this.hold(`<code>${escapeHtml(code.replace(/^ (.*) $/, '$1'))}</code>`),
    )
    text = text.replace(/\\([\\`*_~|[\]()#>!-])/g, (_match, char: string) => this.hold(escapeHtml(char)))

    for (const link of this.links) {
      if (!link.text || !SAFE_HREF.test(link.href)) continue
      // Whole mentions only: "@Al" must not link the start of "@Alice".
      text = text.replace(new RegExp(`${escapeRegExp(link.text)}(?![\\p{L}\\p{N}_])`, 'gu'), () =>
        this.hold(`<a href="${escapeHtml(link.href)}">${escapeHtml(link.text)}</a>`),
      )
    }

    text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label: string, href: string) =>
      SAFE_HREF.test(href) ? this.hold(`<a href="${escapeHtml(href)}">${this.renderNested(label)}</a>`) : match,
    )
    // Bare URLs are kept as they are, so emphasis markers inside them (a_b_c) stay untouched.
    text = text.replace(URL_PATTERN, (url) => this.hold(escapeHtml(url)))

    for (const emoji of this.emojis) {
      if (!emoji.text || !/^mxc:\/\/[^/\s]+\/[^/?#\s]+$/.test(emoji.url)) continue
      text = text.replace(new RegExp(escapeRegExp(emoji.text), 'g'), () =>
        this.hold(`<img data-mx-emoticon src="${escapeHtml(emoji.url)}" alt="${escapeHtml(emoji.text)}" title="${escapeHtml(emoji.text)}" height="32">`),
      )
    }

    text = escapeHtml(text)
    text = text
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
      .replace(/__(?=\S)([\s\S]*?\S)__/g, '<u>$1</u>')
      .replace(/\*(?=[^\s*])([\s\S]*?[^\s*])\*/g, '<em>$1</em>')
      .replace(/(^|[^\w])_(?=[^\s_])([\s\S]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>')
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
      .replace(/\|\|(?=\S)([\s\S]*?\S)\|\|/g, '<span data-mx-spoiler>$1</span>')
      .replace(/\n/g, '<br>')

    return this.restore(text)
  }

  /** Link labels may contain emphasis, but not other links. */
  private renderNested(label: string): string {
    return new InlineRenderer([]).render(label)
  }

  private restore(text: string): string {
    // Placeholders can contain placeholders (escapes inside link labels are rendered separately).
    let result = text
    for (let depth = 0; depth < 3 && result.includes(PH_OPEN); depth += 1) {
      result = result.replace(PLACEHOLDER, (_match, index: string) => this.saved[Number(index)] ?? '')
    }
    return result
  }
}

const FENCE = /^ {0,3}(`{3,})\s*([\w+-]*)\s*$/
const HEADING = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/
const QUOTE = /^ {0,3}> ?(.*)$/
const BULLET = /^ {0,3}[-*+]\s+(.*)$/
const ORDERED = /^ {0,3}(\d{1,9})[.)]\s+(.*)$/
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || QUOTE.test(line) || BULLET.test(line) || ORDERED.test(line) || RULE.test(line)
}

function renderBlocks(lines: string[], inline: InlineRenderer, depth: number): string[] {
  const blocks: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    const fence = FENCE.exec(line)
    if (fence) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith(fence[1])) {
        code.push(lines[index])
        index += 1
      }
      index += 1
      const language = fence[2] ? ` class="language-${escapeHtml(fence[2])}"` : ''
      blocks.push(`<pre><code${language}>${escapeHtml(code.join('\n'))}\n</code></pre>`)
      continue
    }

    if (!line.trim()) {
      index += 1
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      const level = heading[1].length
      blocks.push(`<h${level}>${inline.render(heading[2])}</h${level}>`)
      index += 1
      continue
    }

    if (RULE.test(line)) {
      blocks.push('<hr>')
      index += 1
      continue
    }

    if (QUOTE.test(line) && depth < 10) {
      const quoted: string[] = []
      while (index < lines.length && QUOTE.test(lines[index])) {
        quoted.push(QUOTE.exec(lines[index])![1])
        index += 1
      }
      blocks.push(`<blockquote>${renderBlocks(quoted, inline, depth + 1).join('')}</blockquote>`)
      continue
    }

    const ordered = ORDERED.exec(line)
    if (BULLET.test(line) || ordered) {
      const pattern = ordered ? ORDERED : BULLET
      const items: string[] = []
      while (index < lines.length && pattern.test(lines[index])) {
        const match = pattern.exec(lines[index])!
        items.push(`<li>${inline.render(ordered ? match[2] : match[1])}</li>`)
        index += 1
      }
      const start = ordered && ordered[1] !== '1' ? ` start="${Number(ordered[1])}"` : ''
      blocks.push(ordered ? `<ol${start}>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`)
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length && lines[index].trim() && (paragraph.length === 0 || !startsBlock(lines[index]))) {
      paragraph.push(lines[index])
      index += 1
    }
    blocks.push(`<p>${inline.render(paragraph.join('\n'))}</p>`)
  }

  return blocks
}

/**
 * The HTML for a message, or null when the markdown changes nothing (then only `body` is sent,
 * like Element does).
 */
export function markdownToHtml(markdown: string, links: MarkdownLink[] = [], emojis: MarkdownEmoji[] = []): string | null {
  const source = markdown.replace(/[]/g, '').replace(/\r\n?/g, '\n')
  const blocks = renderBlocks(source.split('\n'), new InlineRenderer(links, emojis), 0)
  // A single paragraph is sent without <p>, as Element does.
  const html = blocks.length === 1 && blocks[0].startsWith('<p>') ? blocks[0].slice(3, -4) : blocks.join('')
  const plain = escapeHtml(source.trim()).replace(/\n/g, '<br>')
  return html === plain ? null : html
}
