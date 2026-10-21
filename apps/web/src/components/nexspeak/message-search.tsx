"use client"

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useTranslation } from "@/hooks/useTranslation"
import { describeMatrixError } from "@nexspeak/core/matrix/errors"
import { getServerRoomIds } from "@nexspeak/core/matrix/server"
import { computeRoomDirectory } from "@/hooks/useRoomDirectory"
import { searchMessages, type MessageSearchResult } from "@nexspeak/core/matrix/message-search"

type SearchQuery = Parameters<typeof searchMessages>[1]

export function MessageSearch({ roomId, serverId, onClose, onJump }: {
  roomId: string
  serverId?: string
  onClose: () => void
  onJump: (roomId: string, eventId: string, threadId?: string) => void
}) {
  const { client } = useMatrixClient()
  const { t, intl } = useTranslation()
  const [scope, setScope] = useState("room")
  const [term, setTerm] = useState("")
  const [sender, setSender] = useState("")
  const [channel, setChannel] = useState("")
  const [after, setAfter] = useState("")
  const [before, setBefore] = useState("")
  const [has, setHas] = useState("")
  const [query, setQuery] = useState<SearchQuery | null>(null)
  const [results, setResults] = useState<MessageSearchResult[]>([])
  const [nextBatch, setNextBatch] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => () => { request.current += 1; abortRef.current?.abort() }, [])

  // This component exists only while the search panel is open. No background index or listeners.
  const scopeRoomIds = useMemo(() => {
    if (!client) return []
    if (scope === "server" && serverId) return getServerRoomIds(client, serverId).channels
    if (scope === "direct") return computeRoomDirectory(client).directRooms.map((room) => room.id)
    return [roomId]
  }, [client, scope, serverId, roomId])
  const rooms = scopeRoomIds.map((id) => client?.getRoom(id)).filter((room) => room?.getMyMembership() === "join")
  const grouped = new Map<string, MessageSearchResult[]>()
  for (const result of results) {
    const group = grouped.get(result.roomId) ?? []
    group.push(result)
    grouped.set(result.roomId, group)
  }

  const runSearch = async (searchQuery: SearchQuery, token?: string) => {
    if (!client) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const generation = ++request.current
    setLoading(true)
    setError(null)
    try {
      const page = await searchMessages(client, searchQuery, token, controller.signal)
      if (generation !== request.current) return
      setResults((previous) => {
        const combined = token ? [...previous, ...page.results] : page.results
        const seen = new Set<string>()
        return combined.filter(({ roomId: id, event }) => {
          const key = `${id}/${event.getId()}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
      })
      setNextBatch(page.nextBatch)
    } catch (cause) {
      if (generation === request.current) setError(describeMatrixError(cause, t("messageSearch.failed")))
    } finally {
      if (generation === request.current) setLoading(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!term.trim()) return
    const searchQuery: SearchQuery = {
      term: term.trim(),
      roomIds: channel && scopeRoomIds.includes(channel) ? [channel] : scopeRoomIds,
      senderId: sender.trim() || undefined,
      after: after ? new Date(`${after}T00:00:00`).getTime() : undefined,
      // "Before" excludes the selected day, matching the field's label.
      before: before ? new Date(`${before}T00:00:00`).getTime() : undefined,
      has: has === "link" || has === "attachment" ? has : undefined,
    }
    setQuery(searchQuery)
    setResults([])
    setNextBatch(undefined)
    void runSearch(searchQuery)
  }

  const fieldClass = "flex min-w-0 flex-col gap-1 text-xs text-muted-foreground"
  const selectClass = "h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground"

  return (
    <aside onKeyDown={(event) => { if (event.key === "Escape") onClose() }} className="absolute inset-0 z-20 flex min-h-0 flex-col border-l border-border bg-background lg:static lg:w-[420px] lg:shrink-0" aria-label={t("messageSearch.title")}>
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="font-semibold">{t("messageSearch.title")}</h3>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label={t("common.close")}><X className="h-4 w-4" /></Button>
      </header>
      <form onSubmit={submit} className="grid grid-cols-2 gap-2 border-b border-border p-3">
        <label className={`${fieldClass} col-span-2`}>
          {t("messageSearch.term")}
          <Input autoFocus value={term} onChange={(event) => setTerm(event.target.value)} required maxLength={500} />
        </label>
        <label className={fieldClass}>
          {t("messageSearch.scope")}
          <select value={scope} onChange={(event) => { setScope(event.target.value); setChannel("") }} className={selectClass}>
            <option value="room">{t("messageSearch.currentRoom")}</option>
            {serverId && <option value="server">{t("messageSearch.server")}</option>}
            <option value="direct">{t("messageSearch.direct")}</option>
          </select>
        </label>
        <label className={fieldClass}>
          {t("messageSearch.channel")}
          <select value={channel} onChange={(event) => setChannel(event.target.value)} className={selectClass}>
            <option value="">{t("messageSearch.allChannels")}</option>
            {rooms.map((room) => room && <option key={room.roomId} value={room.roomId}>{room.name}</option>)}
          </select>
        </label>
        <label className={`${fieldClass} col-span-2`}>
          {t("messageSearch.author")}
          <Input value={sender} onChange={(event) => setSender(event.target.value)} placeholder="@alice:example.org" />
        </label>
        <label className={fieldClass}>{t("messageSearch.after")}<Input type="date" value={after} onChange={(event) => setAfter(event.target.value)} /></label>
        <label className={fieldClass}>{t("messageSearch.before")}<Input type="date" value={before} min={after || undefined} onChange={(event) => setBefore(event.target.value)} /></label>
        <label className={fieldClass}>
          {t("messageSearch.has")}
          <select value={has} onChange={(event) => setHas(event.target.value)} className={selectClass}>
            <option value="">{t("messageSearch.any")}</option>
            <option value="link">{t("messageSearch.link")}</option>
            <option value="attachment">{t("messageSearch.attachment")}</option>
          </select>
        </label>
        <Button type="submit" disabled={loading || !term.trim()} className="self-end"><Search className="h-4 w-4" />{t("messageSearch.search")}</Button>
        <p className="col-span-2 text-xs text-muted-foreground">{t("messageSearch.unencryptedOnly")}</p>
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto p-3" aria-busy={loading}>
        {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
        {!query && <p className="text-sm text-muted-foreground">{t("messageSearch.start")}</p>}
        {query && !loading && !error && !results.length && <p role="status" className="text-sm text-muted-foreground">{t("messageSearch.empty")}</p>}
        {[...grouped].map(([id, matches]) => (
          <section key={id} className="mb-4">
            <h4 className="mb-2 truncate text-sm font-semibold">{client?.getRoom(id)?.name ?? id}</h4>
            <div className="flex flex-col gap-2">
              {matches.map(({ event }) => {
                const eventId = event.getId()
                const author = client?.getRoom(id)?.getMember(event.getSender() ?? "")?.name ?? event.getSender()
                return <button key={eventId} type="button" disabled={!eventId} onClick={() => {
                  if (!eventId) return
                  const relation = event.getContent()["m.relates_to"]
                  onJump(id, eventId, relation?.rel_type === "m.thread" || relation?.rel_type === "io.element.thread" ? relation.event_id : event.threadRootId)
                }} className="rounded border border-border p-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                  <span className="flex flex-wrap justify-between gap-1 text-xs text-muted-foreground"><strong>{author}</strong><time dateTime={new Date(event.getTs()).toISOString()}>{new Date(event.getTs()).toLocaleString(intl)}</time></span>
                  <span className="mt-1 line-clamp-4 block whitespace-pre-wrap break-words text-sm">{typeof event.getContent().body === "string" ? event.getContent().body : ""}</span>
                  <span className="mt-2 block text-xs text-primary">{t("messageSearch.jump")}</span>
                </button>
              })}
            </div>
          </section>
        ))}
        {loading && <div role="status" className="flex justify-center py-4"><Spinner className="h-5 w-5" /><span className="sr-only">{t("messageSearch.loading")}</span></div>}
        {nextBatch && query && <Button variant="outline" disabled={loading} onClick={() => void runSearch(query, nextBatch)} className="w-full">{t("messageSearch.more")}</Button>}
      </div>
    </aside>
  )
}
