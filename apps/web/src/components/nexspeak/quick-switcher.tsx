"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import { Hash, MessageCircle, Server } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { RoomDirectory } from "@/hooks/useRoomDirectory"
import { useTranslation } from "@/hooks/useTranslation"
import { cn } from "@/lib/utils"
import { isQuickSwitcherShortcut, quickDestinations, rememberQuickDestination, searchQuickDestinations, type QuickDestination } from "@/lib/quick-switcher"

function QuickSwitcherSearch({ directory, recentIds, onSelect }: {
  directory: RoomDirectory
  recentIds: readonly string[]
  onSelect: (destination: QuickDestination) => void
}) {
  const { t } = useTranslation()
  const [term, setTerm] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const listId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const destinations = useMemo(() => quickDestinations(directory), [directory])
  const results = useMemo(() => searchQuickDestinations(destinations, term, recentIds).slice(0, 50), [destinations, term, recentIds])
  const activeIndex = Math.min(selectedIndex, Math.max(0, results.length - 1))

  useEffect(() => {
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" })
  }, [activeIndex, term])

  return <>
    <Input
      autoFocus
      role="combobox"
      aria-label={t("quickSwitcher.search")}
      aria-autocomplete="list"
      aria-expanded
      aria-controls={listId}
      aria-activedescendant={results.length ? `${listId}-${activeIndex}` : undefined}
      placeholder={t("quickSwitcher.placeholder")}
      autoComplete="off"
      spellCheck={false}
      value={term}
      onChange={(event) => { setTerm(event.target.value); setSelectedIndex(0) }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault()
          const direction = event.key === "ArrowDown" ? 1 : -1
          setSelectedIndex(results.length ? (activeIndex + direction + results.length) % results.length : 0)
        } else if (event.key === "Enter") {
          event.preventDefault()
          if (results[activeIndex]) onSelect(results[activeIndex])
        }
      }}
    />
    <div ref={listRef} id={listId} role="listbox" aria-label={t("quickSwitcher.results")} className="max-h-80 overflow-y-auto">
      {results.map((destination, index) => {
        const Icon = destination.kind === "server" ? Server : destination.kind === "direct" ? MessageCircle : Hash
        return <button
          key={destination.id}
          id={`${listId}-${index}`}
          role="option"
          type="button"
          tabIndex={-1}
          aria-selected={index === activeIndex}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(destination)}
          className={cn("flex w-full items-center gap-3 rounded px-3 py-2 text-left hover:bg-nx-hover", index === activeIndex && "bg-nx-active")}
        >
          <Icon aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className={cn("block truncate text-sm", destination.unread > 0 && "font-semibold")}>{destination.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{destination.serverName ?? t(destination.kind === "server" ? "quickSwitcher.server" : destination.kind === "direct" ? "quickSwitcher.direct" : "quickSwitcher.room")}</span>
          </span>
          {destination.unread > 0 && <span className="text-xs text-muted-foreground" aria-label={t("quickSwitcher.unread", { count: destination.unread })}>{destination.unread}</span>}
          {destination.mentions > 0 && <span className="rounded-full bg-destructive px-1.5 text-xs text-destructive-foreground" aria-label={t("quickSwitcher.mentions", { count: destination.mentions })}>@{destination.mentions}</span>}
        </button>
      })}
    </div>
    {results.length === 0 && <p role="status" className="py-4 text-center text-sm text-muted-foreground">{t("quickSwitcher.empty")}</p>}
  </>
}

/** Local shortcut only: never registers or changes desktop global call shortcuts. */
export function QuickSwitcher({ directory, activeServerId, activeRoomId, selectServer, openRoom }: {
  directory: RoomDirectory
  activeServerId: string
  activeRoomId: string
  selectServer: (serverId: string) => void
  openRoom: (roomId: string, serverId?: string) => void
}) {
  const { t } = useTranslation()
  const [openHistory, setOpenHistory] = useState<string[] | null>(null)
  const recentIds = useRef<string[]>([])
  const previousFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    recentIds.current = rememberQuickDestination(recentIds.current, activeServerId)
  }, [activeServerId])
  useEffect(() => {
    if (activeRoomId) recentIds.current = rememberQuickDestination(recentIds.current, activeRoomId)
  }, [activeRoomId, activeServerId])
  useEffect(() => {
    const isMac = navigator.platform.toLowerCase().includes("mac")
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isQuickSwitcherShortcut(event, isMac)) return
      event.preventDefault()
      if (document.activeElement instanceof HTMLElement && !document.activeElement.closest("[data-quick-switcher]")) {
        previousFocus.current = document.activeElement
      }
      setOpenHistory([...recentIds.current])
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return <Dialog open={openHistory !== null} onOpenChange={(open) => { if (!open) setOpenHistory(null) }}>
    <DialogContent
      data-quick-switcher=""
      onCloseAutoFocus={(event) => {
        if (previousFocus.current?.isConnected) {
          event.preventDefault()
          previousFocus.current.focus()
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>{t("quickSwitcher.title")}</DialogTitle>
        <DialogDescription>{t("quickSwitcher.description")}</DialogDescription>
      </DialogHeader>
      {openHistory !== null && <QuickSwitcherSearch directory={directory} recentIds={openHistory} onSelect={(destination) => {
        recentIds.current = rememberQuickDestination(recentIds.current, destination.id)
        setOpenHistory(null)
        if (destination.kind === "server") selectServer(destination.id)
        else openRoom(destination.id, destination.serverId)
      }} />}
    </DialogContent>
  </Dialog>
}
