/**
 * Received `formatted_body` (org.matrix.custom.html) → a sanitized node tree that the UI renders
 * as elements, never as HTML. A small tolerant parser of its own (no DOM needed, works on every
 * platform); everything outside the allowlist of the Matrix spec is dropped.
 */

export type FormattedTag =
  | 'a' | 'b' | 'blockquote' | 'br' | 'caption' | 'code' | 'del' | 'details' | 'div' | 'em'
  | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'hr' | 'i' | 'li' | 'ol' | 'p' | 'pre' | 's'
  | 'span' | 'strike' | 'strong' | 'sub' | 'summary' | 'sup' | 'table' | 'tbody' | 'td' | 'th'
  | 'thead' | 'tr' | 'u' | 'ul'

export interface FormattedElement {
  tag: FormattedTag
  attrs: Partial<Record<'href' | 'start' | 'language' | 'spoiler' | 'color' | 'background', string>>
  children: FormattedNode[]
}

export type FormattedNode = string | FormattedElement

const ALLOWED = new Set<string>([
  'a', 'b', 'blockquote', 'br', 'caption', 'code', 'del', 'details', 'div', 'em', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'hr', 'i', 'li', 'ol', 'p', 'pre', 's', 'span', 'strike', 'strong', 'sub',
  'summary', 'sup', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul',
])
/** Dropped together with everything inside. mx-reply is the reply fallback. */
const DROP_WITH_CONTENT = new Set([
  'mx-reply', 'script', 'style', 'head', 'title', 'iframe', 'object', 'embed', 'svg', 'math',
  'template', 'textarea', 'select', 'noscript', 'canvas', 'audio', 'video',
])
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'wbr', 'col', 'area', 'base'])
/** The spec's recommended limit; deeper nesting is flattened into its text. */
const MAX_DEPTH = 100
const SAFE_HREF = /^(https?:\/\/|mailto:|matrix:)/i
const COLOR = /^#[0-9a-fA-F]{6}$/

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™', euro: '€', shy: '­',
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
      // No control characters or lone surrogates.
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return match
      return String.fromCodePoint(code)
    }
    return NAMED_ENTITIES[entity] ?? match
  })
}

const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

function parseAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>()
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = match[1].toLowerCase()
    if (!attributes.has(name)) attributes.set(name, decodeEntities(match[2] ?? match[3] ?? match[4] ?? ''))
  }
  return attributes
}

function sanitizeAttributes(tag: FormattedTag, raw: Map<string, string>): FormattedElement['attrs'] {
  const attrs: FormattedElement['attrs'] = {}
  if (tag === 'a') {
    const href = raw.get('href')?.trim()
    if (href && SAFE_HREF.test(href)) attrs.href = href
  } else if (tag === 'ol') {
    const start = Number(raw.get('start'))
    if (Number.isInteger(start) && start >= 0 && start < 1e9) attrs.start = String(start)
  } else if (tag === 'code') {
    const language = /(?:^|\s)language-([\w+-]{1,32})(?:\s|$)/.exec(raw.get('class') ?? '')
    if (language) attrs.language = language[1]
  }
  if (tag === 'span') {
    if (raw.has('data-mx-spoiler')) attrs.spoiler = raw.get('data-mx-spoiler') ?? ''
    const color = raw.get('data-mx-color') ?? raw.get('color')
    if (color && COLOR.test(color)) attrs.color = color
    const background = raw.get('data-mx-bg-color')
    if (background && COLOR.test(background)) attrs.background = background
  }
  return attrs
}

interface OpenElement {
  name: string
  element: FormattedElement | null
  children: FormattedNode[]
}

function appendText(children: FormattedNode[], text: string): void {
  if (!text) return
  const last = children[children.length - 1]
  if (typeof last === 'string') children[children.length - 1] = last + text
  else children.push(text)
}

const TOKEN = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<![^>]*>?|<\?[^>]*>?|<\/\s*([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g

export function parseFormattedBody(html: string): FormattedNode[] {
  const root: OpenElement = { name: '#root', element: null, children: [] }
  const stack: OpenElement[] = [root]
  /** Inside a dropped element: its name and nesting count of the same tag. */
  let dropping: { name: string; depth: number } | null = null
  let lastIndex = 0

  const current = () => stack[stack.length - 1]
  const closeTop = () => {
    const top = stack.pop()!
    const parent = current()
    if (top.element) {
      top.element.children = top.children
      parent.children.push(top.element)
    } else {
      // A disallowed element: keep what's inside.
      top.children.forEach((child) => (typeof child === 'string' ? appendText(parent.children, child) : parent.children.push(child)))
    }
  }

  for (const match of html.matchAll(TOKEN)) {
    const text = html.slice(lastIndex, match.index)
    lastIndex = match.index + match[0].length
    if (!dropping) appendText(current().children, decodeEntities(text))

    const [, closingName, openingName, rawAttributes, selfClosing] = match
    if (!closingName && !openingName) continue // Comment, doctype, CDATA, processing instruction.

    const name = (closingName ?? openingName).toLowerCase()

    if (dropping) {
      if (name === dropping.name) {
        if (openingName && !selfClosing) dropping.depth += 1
        if (closingName) dropping.depth -= 1
        if (dropping.depth === 0) dropping = null
      }
      continue
    }

    if (openingName) {
      if (DROP_WITH_CONTENT.has(name)) {
        if (!selfClosing) dropping = { name, depth: 1 }
        continue
      }
      if (name === 'img') {
        // No remote images (tracking); custom emoji and the like show their text instead.
        const attributes = parseAttributes(rawAttributes)
        const alt = attributes.get('alt') ?? attributes.get('title')
        if (alt) appendText(current().children, alt)
        continue
      }
      const allowed = ALLOWED.has(name) || name === 'font'
      // Older clients use <font color>; it renders like a span.
      const tag = (name === 'font' ? 'span' : name) as FormattedTag
      const element: FormattedElement | null =
        allowed && stack.length <= MAX_DEPTH ? { tag, attrs: sanitizeAttributes(tag, parseAttributes(rawAttributes)), children: [] } : null
      if (VOID.has(name) || selfClosing) {
        if (element) current().children.push(element)
        continue
      }
      // <p> and <li> close an open one of the same kind, as browsers do.
      if ((name === 'p' || name === 'li') && current().name === name) closeTop()
      stack.push({ name, element, children: [] })
      continue
    }

    // Closing tag: close up to the matching open element; stray closing tags are ignored.
    const openIndex = stack.map((entry) => entry.name).lastIndexOf(name)
    if (openIndex > 0) {
      while (stack.length > openIndex) closeTop()
    }
  }

  if (!dropping) appendText(current().children, decodeEntities(html.slice(lastIndex)))
  while (stack.length > 1) closeTop()
  return root.children
}

/** The plain text of a tree (for previews and the edit composer's mention links). */
export function formattedText(nodes: FormattedNode[]): string {
  return nodes.map((node) => (typeof node === 'string' ? node : node.tag === 'br' ? '\n' : formattedText(node.children))).join('')
}

/** All links of a tree with their text, e.g. mention pills. */
export function formattedLinks(nodes: FormattedNode[]): Array<{ text: string; href: string }> {
  return nodes.flatMap((node) => {
    if (typeof node === 'string') return []
    if (node.tag === 'a' && node.attrs.href) return [{ text: formattedText(node.children), href: node.attrs.href }]
    return formattedLinks(node.children)
  })
}
