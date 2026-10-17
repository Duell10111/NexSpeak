"use client"

import { Fragment, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/hooks/useTranslation"
import { parseMatrixLink } from "@nexspeak/core/matrix/links"
import type { FormattedElement, FormattedNode } from "@nexspeak/core/matrix/formatted-body"
import { setPendingLink } from "@/lib/pending-link"

const URL_PATTERN = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g

function ExternalOrMatrixLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      onClick={(event) => {
        // matrix.to links to rooms and people open in the app, like in Element.
        const link = parseMatrixLink(href)
        if (!link || link.kind === "sso") return
        event.preventDefault()
        setPendingLink(link)
      }}
      className={className}
    >
      {children}
    </a>
  )
}

export function LinkifiedText({ text }: { text: string }) {
  const parts = text.split(URL_PATTERN)
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <ExternalOrMatrixLink key={index} href={part} className="break-all text-primary hover:underline">
            {part}
          </ExternalOrMatrixLink>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  )
}

function Spoiler({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [revealed, setRevealed] = useState(false)
  return (
    <span
      role={revealed ? undefined : "button"}
      tabIndex={revealed ? undefined : 0}
      aria-label={revealed ? undefined : t("chat.spoiler")}
      onClick={() => setRevealed(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") setRevealed(true)
      }}
      className={cn(
        "rounded px-0.5 transition-colors",
        revealed ? "bg-foreground/10" : "cursor-pointer bg-foreground text-transparent select-none [&_*]:invisible",
      )}
    >
      {children}
    </span>
  )
}

/** A matrix.to link to a person or room, shown as a pill like Discord's mentions. */
function isPill(element: FormattedElement): boolean {
  const link = element.attrs.href ? parseMatrixLink(element.attrs.href) : null
  return link?.kind === "user" || (link?.kind === "room" && !link.eventId)
}

function renderChildren(nodes: FormattedNode[], inCode: boolean): ReactNode {
  return nodes.map((node, index) => <Fragment key={index}>{renderNode(node, inCode)}</Fragment>)
}

function renderNode(node: FormattedNode, inCode: boolean): ReactNode {
  if (typeof node === "string") return inCode ? node : <LinkifiedText text={node} />
  const children = (code = inCode) => renderChildren(node.children, code)

  switch (node.tag) {
    case "a":
      if (!node.attrs.href) return children()
      if (isPill(node)) {
        return (
          <ExternalOrMatrixLink
            href={node.attrs.href}
            className="rounded bg-primary/15 px-0.5 font-medium text-primary hover:bg-primary hover:text-primary-foreground"
          >
            {renderChildren(node.children, true)}
          </ExternalOrMatrixLink>
        )
      }
      return (
        <ExternalOrMatrixLink href={node.attrs.href} className="break-all text-primary hover:underline">
          {renderChildren(node.children, true)}
        </ExternalOrMatrixLink>
      )
    case "b":
    case "strong":
      return <strong className="font-semibold">{children()}</strong>
    case "i":
    case "em":
      return <em>{children()}</em>
    case "u":
      return <u>{children()}</u>
    case "s":
    case "del":
    case "strike":
      return <del>{children()}</del>
    case "sub":
      return <sub>{children()}</sub>
    case "sup":
      return <sup>{children()}</sup>
    case "code":
      return inCode ? (
        children(true)
      ) : (
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[85%]">{children(true)}</code>
      )
    case "pre":
      return (
        <pre className="my-1 max-w-full overflow-x-auto rounded-md border border-border bg-muted p-2 font-mono text-[13px] leading-5 whitespace-pre-wrap">
          {children(true)}
        </pre>
      )
    case "blockquote":
      return <blockquote className="my-0.5 border-l-4 border-muted-foreground/40 pl-3">{children()}</blockquote>
    case "p":
    case "div":
      return <div>{children()}</div>
    case "br":
      return <br />
    case "hr":
      return <hr className="my-2 border-border" />
    case "h1":
      return <div className="mt-1 text-2xl font-bold">{children()}</div>
    case "h2":
      return <div className="mt-1 text-xl font-bold">{children()}</div>
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return <div className="mt-1 text-base font-bold">{children()}</div>
    case "ul":
      return <ul className="my-0.5 list-disc pl-6">{children()}</ul>
    case "ol":
      return (
        <ol className="my-0.5 list-decimal pl-6" start={node.attrs.start ? Number(node.attrs.start) : undefined}>
          {children()}
        </ol>
      )
    case "li":
      return <li>{children()}</li>
    case "span":
      if (node.attrs.spoiler !== undefined) return <Spoiler>{children()}</Spoiler>
      return (
        <span style={{ color: node.attrs.color, backgroundColor: node.attrs.background }}>{children()}</span>
      )
    case "details":
      return <details>{children()}</details>
    case "summary":
      return <summary className="cursor-pointer">{children()}</summary>
    case "table":
      return (
        <div className="max-w-full overflow-x-auto">
          <table className="my-1 border-collapse text-sm">{children()}</table>
        </div>
      )
    case "thead":
      return <thead>{children()}</thead>
    case "tbody":
      return <tbody>{children()}</tbody>
    case "tr":
      return <tr>{children()}</tr>
    case "th":
      return <th className="border border-border px-2 py-1 text-left font-semibold">{children()}</th>
    case "td":
      return <td className="border border-border px-2 py-1">{children()}</td>
    case "caption":
      return <caption className="text-xs text-muted-foreground">{children()}</caption>
    default:
      return children()
  }
}

/** A sanitized formatted body (see parseFormattedBody); no HTML is ever injected. */
export function FormattedMessage({ nodes }: { nodes: FormattedNode[] }) {
  return <span className="whitespace-normal">{renderChildren(nodes, false)}</span>
}
