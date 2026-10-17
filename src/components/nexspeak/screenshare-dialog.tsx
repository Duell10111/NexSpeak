"use client"

import { useState } from "react"
import { MonitorUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  resolutionLabel,
  screenShareBitrate,
  SCREENSHARE_FRAMERATES,
  SCREENSHARE_RESOLUTIONS,
  type ScreenShareQuality,
} from "@/lib/screenshare-quality"
import { hasSoftwareOnlyVideoEncoder } from "@/lib/video-codec"

function OptionGroup<T extends string | number>({
  label,
  options,
  value,
  format,
  onChange,
}: {
  label: string
  options: readonly T[]
  value: T
  format: (option: T) => string
  onChange: (option: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="space-y-2">
      <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="grid grid-cols-4 gap-2">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={option === value}
            onClick={() => onChange(option)}
            className={cn(
              "h-10 rounded-md border text-sm font-medium transition-colors",
              option === value
                ? "border-primary bg-primary/15 text-foreground"
                : "border-transparent bg-nx-panel text-muted-foreground hover:bg-nx-active hover:text-foreground",
            )}
          >
            {format(option)}
          </button>
        ))}
      </div>
    </div>
  )
}

export function StreamQualityOptions({
  quality,
  onChange,
}: {
  quality: ScreenShareQuality
  onChange: (quality: ScreenShareQuality) => void
}) {
  return (
    <div className="space-y-4">
      <OptionGroup
        label="Auflösung"
        options={SCREENSHARE_RESOLUTIONS}
        value={quality.resolution}
        format={resolutionLabel}
        onChange={(resolution) => onChange({ ...quality, resolution })}
      />
      <OptionGroup
        label="Bildrate"
        options={SCREENSHARE_FRAMERATES}
        value={quality.fps}
        format={(fps) => `${fps} FPS`}
        onChange={(fps) => onChange({ ...quality, fps })}
      />
      <p className="text-xs text-muted-foreground">
        Benötigt bis zu {(screenShareBitrate(quality) / 1_000_000).toLocaleString("de-DE", { maximumFractionDigits: 1 })}{" "}
        Mbit/s Upload. Für Spiele 60 FPS wählen, für Text und Code reichen 15 FPS in hoher Auflösung.
      </p>
      {hasSoftwareOnlyVideoEncoder() && (
        <p className="rounded-md bg-nx-idle/10 px-3 py-2 text-xs text-nx-idle" data-testid="software-encoder-hint">
          Firefox kodiert Video ohne Grafikkarte. Das belastet die CPU und reicht oft nicht für hohe Auflösungen mit
          60 FPS. Für Spiele besser Chrome, Edge oder Safari verwenden oder 1080p mit 30 FPS wählen.
        </p>
      )}
    </div>
  )
}

function StreamQualityForm({
  initialQuality,
  onStart,
  onCancel,
}: {
  initialQuality: ScreenShareQuality
  onStart: (quality: ScreenShareQuality) => void
  onCancel: () => void
}) {
  const [quality, setQuality] = useState(initialQuality)
  return (
    <>
      <StreamQualityOptions quality={quality} onChange={setQuality} />
      <DialogFooter>
        <button
          type="button"
          onClick={onCancel}
          className="h-10 rounded-md px-4 text-sm font-medium text-foreground hover:underline"
        >
          Abbrechen
        </button>
        <button
          type="button"
          onClick={() => onStart(quality)}
          className="flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <MonitorUp className="h-4 w-4" />
          Live gehen
        </button>
      </DialogFooter>
    </>
  )
}

export function ScreenshareDialog({
  open,
  onOpenChange,
  initialQuality,
  onStart,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialQuality: ScreenShareQuality
  onStart: (quality: ScreenShareQuality) => void
}) {
  // In fullscreen only the fullscreen element is visible, so the dialog has to live there.
  const container = open && typeof document !== "undefined" ? (document.fullscreenElement as HTMLElement | null) : null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent container={container} className="gap-5 border-none bg-background sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bildschirm teilen</DialogTitle>
          <DialogDescription>
            Wähle die Stream-Qualität. Danach fragt der Browser, welchen Bildschirm, welches Fenster oder welchen Tab du
            teilen möchtest.
          </DialogDescription>
        </DialogHeader>
        {/* Remount per opening so the form starts from the remembered quality. */}
        {open && <StreamQualityForm initialQuality={initialQuality} onStart={onStart} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}
