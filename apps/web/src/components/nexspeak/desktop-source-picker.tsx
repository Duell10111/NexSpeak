"use client"

import { useEffect, useState } from "react"
import type { DisplaySource } from "@nexspeak/core/desktop-bridge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useTranslation } from "@/hooks/useTranslation"
import { desktopBridge } from "@/lib/desktop"

interface PendingRequest {
  sources: DisplaySource[]
  resolve: (sourceId: string | null) => void
}

/**
 * Desktop app only: the screen/window picker that a browser would show for getDisplayMedia.
 * The main process asks for it when the OS has no picker of its own (Windows, Linux on X11).
 */
export function DesktopSourcePicker() {
  const { t } = useTranslation()
  const [request, setRequest] = useState<PendingRequest | null>(null)

  useEffect(() => {
    return desktopBridge()?.onChooseDisplaySource(
      (sources) => new Promise((resolve) => setRequest({ sources, resolve })),
    )
  }, [])

  const finish = (sourceId: string | null) => {
    request?.resolve(sourceId)
    setRequest(null)
  }

  const screens = request?.sources.filter((source) => source.kind === "screen") ?? []
  const windows = request?.sources.filter((source) => source.kind === "window") ?? []
  // In fullscreen only the fullscreen element is visible, so the dialog has to live there.
  const container = request && typeof document !== "undefined" ? (document.fullscreenElement as HTMLElement | null) : null

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && finish(null)}>
      <DialogContent container={container} className="gap-5 border-none bg-background sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("stream.pickSource")}</DialogTitle>
          <DialogDescription>{t("stream.pickSourceDescription")}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
          <SourceGroup title={t("stream.screens")} sources={screens} onPick={finish} />
          <SourceGroup title={t("stream.windows")} sources={windows} onPick={finish} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => finish(null)}>
            {t("common.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SourceGroup({
  title,
  sources,
  onPick,
}: {
  title: string
  sources: DisplaySource[]
  onPick: (sourceId: string) => void
}) {
  if (sources.length === 0) return null
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase text-muted-foreground">{title}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {sources.map((source) => (
          <button
            key={source.id}
            type="button"
            onClick={() => onPick(source.id)}
            className="group flex flex-col gap-1.5 rounded-md p-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- data: URLs cannot go through next/image */}
            <img src={source.thumbnail} alt="" className="aspect-video w-full rounded bg-black object-contain" />
            <span className="truncate text-sm">{source.name}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
