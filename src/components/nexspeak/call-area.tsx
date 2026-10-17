"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react"
import { EventType } from "matrix-js-sdk"
import { toast } from "sonner"
import type { RemoteVideoTrack } from "livekit-client"
import {
  Headphones,
  HeadphoneOff,
  Lock,
  Maximize,
  Maximize2,
  Menu,
  MessageSquare,
  Mic,
  MicOff,
  Minimize,
  Minimize2,
  MonitorUp,
  PhoneOff,
  ScreenShareOff,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"
import { Slider } from "@/components/ui/slider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MatrixAvatar } from "@/components/nexspeak/matrix-avatar"
import { RoomChat } from "@/components/nexspeak/room-chat"
import { useCallContext, type CallParticipant, type CallVideoFeed } from "@/components/nexspeak/call-context"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useTranslation } from "@/hooks/useTranslation"
import type { Translate } from "@/lib/i18n"
import { enableCallsInRoom, membersCanJoinCalls } from "@/lib/matrix/rtc"
import { describeMatrixError } from "@/lib/matrix/errors"
import { fitGrid, TILE_ASPECT, TILE_GAP_PX } from "@/lib/call-layout"
import {
  resolutionLabel,
  SCREENSHARE_FRAMERATES,
  SCREENSHARE_RESOLUTIONS,
  type ScreenShareFramerate,
  type ScreenShareResolution,
} from "@/lib/screenshare-quality"
import { createDecoderSampler, formatMbit, isEncoderOverloaded } from "@/lib/video-codec"


/** One tile on the stage: a participant (with camera, if on) or a screenshare. */
interface CallTile {
  id: string
  participant: CallParticipant
  feed?: CallVideoFeed
  isScreenshare: boolean
}

function buildTiles(participants: CallParticipant[], feeds: CallVideoFeed[]): CallTile[] {
  const tiles: CallTile[] = participants.map((participant) => ({
    id: participant.identity,
    participant,
    feed: feeds.find((feed) => feed.identity === participant.identity && !feed.isScreenshare),
    isScreenshare: false,
  }))
  feeds
    .filter((feed) => feed.isScreenshare)
    .forEach((feed) => {
      const participant = participants.find((candidate) => candidate.identity === feed.identity)
      if (participant) tiles.push({ id: feed.id, participant, feed, isScreenshare: true })
    })
  return tiles
}

function useElementSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize((current) => (current.width === width && current.height === height ? current : { width, height }))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return size
}

/** Discord-like tile colour for people without camera, stable per user. */
function tileColor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i += 1) hash = (hash * 31 + userId.charCodeAt(i)) | 0
  return `hsl(${Math.abs(hash) % 360} 30% 32%)`
}

function VideoView({ feed }: { feed: CallVideoFeed }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const element = videoRef.current
    if (!element) return
    feed.track.attach(element)
    return () => {
      feed.track.detach(element)
    }
  }, [feed.track])

  return (
    // Audio is played through LiveKit's own audio elements; video stays muted.
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className={cn(
        "absolute inset-0 h-full w-full",
        feed.isScreenshare ? "object-contain" : "object-cover",
        feed.isLocal && !feed.isScreenshare && "-scale-x-100",
      )}
    />
  )
}

function TileMenu({
  tile,
  isFocused,
  onToggleFocus,
  children,
}: {
  tile: CallTile
  isFocused: boolean
  onToggleFocus: () => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  const { setParticipantVolume, setParticipantMuted } = useCallContext()
  const { participant } = tile

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={onToggleFocus}>{isFocused ? t("call.unfocus") : t("call.focus")}</ContextMenuItem>
        {tile.feed && !tile.feed.isLocal && (
          <>
            <ContextMenuSeparator />
            <ContextMenuLabel className="text-xs font-normal text-muted-foreground">
              {tile.isScreenshare ? t("call.streamInfo") : t("call.videoInfo")}
            </ContextMenuLabel>
            <DecoderStatus feed={tile.feed} />
          </>
        )}
        {!participant.isLocal && (
          <>
            <ContextMenuSeparator />
            <ContextMenuLabel className="text-xs font-normal text-muted-foreground">{t("call.userVolume")}</ContextMenuLabel>
            <div className="flex items-center gap-2 px-2 pb-2" onKeyDown={(event) => event.stopPropagation()}>
              <Slider
                min={0}
                max={100}
                step={1}
                value={[Math.round(participant.volume * 100)]}
                onValueChange={([value]) => setParticipantVolume(participant.identity, value / 100)}
                aria-label={t("call.volumeOf", { name: participant.name })}
              />
              <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">
                {Math.round(participant.volume * 100)}%
              </span>
            </div>
            <ContextMenuCheckboxItem
              checked={participant.isLocallyMuted}
              onCheckedChange={(checked) => setParticipantMuted(participant.identity, checked)}
            >
              {t("call.mute")}
            </ContextMenuCheckboxItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

function CallTileView({
  tile,
  isFocused,
  size,
  onToggleFocus,
  className,
  style,
}: {
  tile: CallTile
  isFocused: boolean
  size: "stage" | "grid" | "strip"
  onToggleFocus: () => void
  className?: string
  style?: React.CSSProperties
}) {
  const { t } = useTranslation()
  const { participant, feed, isScreenshare } = tile
  const isSpeaking = participant.isSpeaking && !participant.isMicMuted && !isScreenshare
  const avatarSize = size === "strip" ? 40 : size === "stage" ? 96 : 80

  return (
    <TileMenu tile={tile} isFocused={isFocused} onToggleFocus={onToggleFocus}>
      <div
        data-testid="call-tile"
        data-connecting={participant.isConnecting || undefined}
        onClick={onToggleFocus}
        className={cn(
          "group relative cursor-pointer overflow-hidden rounded-lg",
          feed ? "bg-black" : "bg-[var(--tile-color)]",
          className,
        )}
        style={{ ...style, "--tile-color": tileColor(participant.userId) } as React.CSSProperties}
      >
        {feed ? (
          <VideoView feed={feed} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className={cn("rounded-full", isSpeaking && "ring-[3px] ring-nx-online ring-offset-0")}>
              <MatrixAvatar
                mxcUrl={participant.avatarMxc}
                name={participant.name}
                size={avatarSize}
                className={cn(size === "strip" ? "text-base" : "text-3xl", participant.isConnecting && "opacity-50")}
              />
            </div>
          </div>
        )}

        {/* Speaking: green border around the whole tile, like Discord. */}
        <div
          className={cn(
            "pointer-events-none absolute inset-0 rounded-lg border-2 transition-colors",
            isSpeaking ? "border-nx-online" : "border-transparent",
          )}
        />

        <div
          className={cn(
            "absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-md bg-black/60 px-2 py-0.5 font-medium text-white",
            size === "strip" ? "text-xs" : "text-sm",
          )}
        >
          {isScreenshare && (
            <span className="rounded bg-nx-dnd px-1 text-[10px] font-bold uppercase tracking-wide">{t("call.live")}</span>
          )}
          {!isScreenshare && participant.isMicMuted && !participant.isConnecting && (
            <MicOff className="h-3.5 w-3.5 shrink-0 text-nx-dnd" aria-label={t("call.muted")} />
          )}
          {participant.isLocallyMuted && <VolumeX className="h-3.5 w-3.5 shrink-0 text-nx-dnd" aria-label={t("call.mutedForYou")} />}
          <span className="truncate">{participant.name}</span>
          {participant.isConnecting && <span className="shrink-0 text-white/70">· {t("call.connecting")}</span>}
        </div>

        {size !== "strip" && (
          <button
            onClick={(event) => {
              event.stopPropagation()
              onToggleFocus()
            }}
            className="absolute top-2 right-2 rounded-md bg-black/60 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={isFocused ? t("call.unfocus") : t("call.focus")}
          >
            {isFocused ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        )}
      </div>
    </TileMenu>
  )
}

function TileGrid({ tiles, onFocus }: { tiles: CallTile[]; onFocus: (id: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { width, height } = useElementSize(containerRef)
  const { tileWidth } = fitGrid(tiles.length, width, height)

  return (
    <div ref={containerRef} className="min-h-0 flex-1">
      <div className="flex h-full flex-wrap content-center items-center justify-center" style={{ gap: TILE_GAP_PX }}>
        {tileWidth > 0 &&
          tiles.map((tile) => (
            <CallTileView
              key={tile.id}
              tile={tile}
              isFocused={false}
              size="grid"
              onToggleFocus={() => onFocus(tile.id)}
              style={{ width: tileWidth, height: tileWidth / TILE_ASPECT }}
            />
          ))}
      </div>
    </div>
  )
}

function FocusView({ focused, others, onFocus }: { focused: CallTile; others: CallTile[]; onFocus: (id: string | null) => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <CallTileView tile={focused} isFocused size="stage" onToggleFocus={() => onFocus(null)} className="min-h-0 flex-1" />
      {others.length > 0 && (
        <div className="flex shrink-0 justify-center gap-2 overflow-x-auto pb-1">
          {others.map((tile) => (
            <CallTileView
              key={tile.id}
              tile={tile}
              isFocused={false}
              size="strip"
              onToggleFocus={() => onFocus(tile.id)}
              className="aspect-video h-24 shrink-0 sm:h-28"
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Admins learn that other members can't join yet, and can fix it in one click. */
function CallPermissionHint({ roomId }: { roomId: string }) {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const [isEnabling, setIsEnabling] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const room = client?.getRoom(roomId)
  const userId = client?.getUserId() ?? ""

  if (!client || !room || enabled || membersCanJoinCalls(room)) return null
  if (!room.currentState.maySendStateEvent(EventType.RoomPowerLevels, userId)) return null

  const enable = async () => {
    setIsEnabling(true)
    try {
      await enableCallsInRoom(client, roomId)
      setEnabled(true)
      toast.success(t("call.callsEnabled"))
    } catch (error) {
      toast.error(describeMatrixError(error, t("call.permissionsFailed")))
    } finally {
      setIsEnabling(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-3 rounded-lg bg-nx-idle/15 px-4 py-2 text-sm text-white">
      <span>{t("call.othersCannotJoin")}</span>
      <button
        onClick={() => void enable()}
        disabled={isEnabling}
        className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {t("call.allowEveryone")}
      </button>
    </div>
  )
}

/** "on": a feature is active (white, like Discord); "off": muted (red icon). */
type ControlVariant = "default" | "on" | "off" | "danger"

function controlButtonClass(variant: ControlVariant) {
  return cn(
    "flex h-12 w-12 items-center justify-center rounded-full transition-colors sm:h-14 sm:w-14",
    variant === "danger" && "bg-nx-dnd text-white hover:bg-nx-dnd/85",
    variant === "on" && "bg-white text-black hover:bg-white/85",
    variant === "off" && "bg-white/10 text-nx-dnd hover:bg-white/15",
    variant === "default" && "bg-white/10 text-white hover:bg-white/15",
  )
}

function ControlButton({
  label,
  variant = "default",
  onClick,
  children,
}: {
  label: string
  variant?: ControlVariant
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={controlButtonClass(variant)}
          aria-label={label}
          aria-pressed={variant === "on" || variant === "off" ? true : undefined}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

const STATS_POLL_MS = 1_000

/** Polls a WebRTC stats sampler while mounted (i.e. only while its menu is open). */
function usePolledStats<T>(createSampler: () => (() => Promise<T | null>) | null): T | null {
  const [stats, setStats] = useState<T | null>(null)

  useEffect(() => {
    const sample = createSampler()
    if (!sample) return
    let cancelled = false
    const poll = () =>
      void sample()
        .then((next) => {
          if (!cancelled) setStats(next)
        })
        .catch(() => {})
    poll()
    const timer = window.setInterval(poll, STATS_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [createSampler])

  return stats
}

function hardwareLabel(t: Translate, hardware: boolean | null, implementation: string, kind: "Encoder" | "Decoder"): string {
  const base = hardware === null ? t("call.codecUnknown", { kind }) : hardware ? "Hardware" : "Software"
  return implementation ? `${base} (${implementation})` : base
}

/** Live encoder diagnostics of our own stream. */
function EncoderStatus() {
  const { t, intl } = useTranslation()
  const { createScreenShareEncoderSampler, screenShareQuality } = useCallContext()
  const info = usePolledStats(createScreenShareEncoderSampler)
  if (!info) return null
  // Hardware encoders work pipelined: their encode time is latency, not load.
  const overloaded =
    info.limitation !== "cpu" && info.hardware !== true && isEncoderOverloaded(info.encodeMs, screenShareQuality.fps)
  return (
    <div className="space-y-0.5 px-2 pb-1.5 text-xs text-muted-foreground" data-testid="encoder-status">
      <div className="break-words">
        {info.codec || "Video"} · {hardwareLabel(t, info.hardware, info.implementation, "Encoder")}
      </div>
      {info.height > 0 && (
        <div>
          {info.height}p · {info.fps} FPS
          {info.encodeMs !== null &&
            ` · ${t("call.msPerFrame", { ms: info.encodeMs.toLocaleString(intl, { maximumFractionDigits: 1 }) })}`}
        </div>
      )}
      {info.bitrate !== null && (
        <div>
          {t("call.upload", { rate: formatMbit(info.bitrate) })}
          {info.targetBitrate > 0 && ` ${t("call.uploadTarget", { rate: formatMbit(info.targetBitrate) })}`}
        </div>
      )}
      {info.limitation === "cpu" && <div className="text-nx-idle">{t("call.limitedByCpu")}</div>}
      {overloaded && (
        <div className="text-nx-idle">{t("call.encoderOverloaded")}</div>
      )}
      {info.limitation === "bandwidth" && <div className="text-nx-idle">{t("call.limitedByBandwidth")}</div>}
    </div>
  )
}

/** What arrives from a remote video and how it decodes (right-click menu of a tile). */
function DecoderStatus({ feed }: { feed: CallVideoFeed }) {
  const { t } = useTranslation()
  const createSampler = useCallback(() => {
    const receiver = (feed.track as RemoteVideoTrack).receiver
    return receiver ? createDecoderSampler(receiver) : null
  }, [feed.track])
  const info = usePolledStats(createSampler)
  if (!info) return null
  return (
    <div className="space-y-0.5 px-2 pb-1.5 text-xs text-muted-foreground" data-testid="decoder-status">
      <div>
        {info.height}p · {info.fps} FPS{info.bitrate !== null && ` · ${formatMbit(info.bitrate)}`}
      </div>
      <div className="break-words">
        {info.codec || "Video"} · {hardwareLabel(t, info.hardware, info.implementation, "Decoder")}
      </div>
      <div>
        {t("call.decoderStats", { dropped: info.framesDropped, freezes: info.freezeCount, lost: info.packetsLost })}
      </div>
    </div>
  )
}

/**
 * Screenshare button. While streaming it opens Discord's stream menu: change the quality
 * on the fly or end the stream.
 */
function ScreenshareControl() {
  const { t } = useTranslation()
  const { call, toggleScreenshare, screenShareQuality, changeScreenShareQuality } = useCallContext()
  // In fullscreen only the fullscreen element is visible, so the menu has to live there.
  const container = typeof document !== "undefined" ? (document.fullscreenElement as HTMLElement | null) : null
  if (!call?.isScreensharing) {
    return (
      <ControlButton label={t("call.shareScreen")} onClick={() => void toggleScreenshare()}>
        <MonitorUp className="h-6 w-6" />
      </ControlButton>
    )
  }
  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button className={controlButtonClass("on")} aria-label={t("call.streamSettings")}>
              <ScreenShareOff className="h-6 w-6" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("call.streamSettings")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent container={container} side="top" align="center" className="w-56">
        <DropdownMenuLabel>{t("call.stream")}</DropdownMenuLabel>
        <EncoderStatus />
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t("stream.resolution")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={screenShareQuality.resolution}
          onValueChange={(value) =>
            void changeScreenShareQuality({ ...screenShareQuality, resolution: value as ScreenShareResolution })
          }
        >
          {SCREENSHARE_RESOLUTIONS.map((resolution) => (
            <DropdownMenuRadioItem key={resolution} value={resolution} onSelect={(event) => event.preventDefault()}>
              {resolutionLabel(resolution)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t("stream.framerate")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={String(screenShareQuality.fps)}
          onValueChange={(value) =>
            void changeScreenShareQuality({ ...screenShareQuality, fps: Number(value) as ScreenShareFramerate })
          }
        >
          {SCREENSHARE_FRAMERATES.map((fps) => (
            <DropdownMenuRadioItem key={fps} value={String(fps)} onSelect={(event) => event.preventDefault()}>
              {fps} FPS
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => void toggleScreenshare()}>
          <ScreenShareOff className="h-4 w-4" />
          {t("call.endStream")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TopBarButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
            active ? "text-white" : "text-white/70 hover:text-white",
          )}
          aria-label={label}
          aria-pressed={active}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === ref.current)
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [ref])

  const toggle = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      ref.current?.requestFullscreen().catch((error: unknown) => console.warn("Fullscreen not available:", error))
    }
  }

  return { isFullscreen, toggle }
}

export function CallArea({ onOpenNavigation }: { onOpenNavigation: () => void }) {
  const {
    call,
    isMicMuted,
    isDeafened,
    toggleMicrophone,
    toggleDeafen,
    toggleCamera,
    leaveCall,
    resumeAudio,
  } = useCallContext()
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const rootRef = useRef<HTMLDivElement>(null)
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(rootRef)
  const [isChatOpen, setIsChatOpen] = useState(false)
  // undefined: follow screenshares automatically; null: grid chosen by the user.
  const [focusChoice, setFocusChoice] = useState<string | null | undefined>(undefined)

  const tiles = useMemo(() => (call ? buildTiles(call.participants, call.videoFeeds) : []), [call])

  // Like Discord's "watch stream": a remote screenshare takes the stage until the user picks otherwise.
  const autoFocusId = tiles.findLast((tile) => tile.isScreenshare && !tile.participant.isLocal)?.id ?? null
  const chosen = focusChoice === undefined ? autoFocusId : focusChoice
  const focused = tiles.find((tile) => tile.id === chosen) ?? null

  useEffect(() => {
    if (!focused) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.fullscreenElement) setFocusChoice(null)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [focused])

  if (!call) return null

  const roomName = client?.getRoom(call.roomId)?.name || t("call.voiceChannel")
  const isReconnecting = call.connectionState === "reconnecting"

  return (
    <div ref={rootRef} className="relative flex h-full min-w-0 flex-1 bg-black">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-12 shrink-0 items-center justify-between gap-2 px-2 text-white sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              onClick={onOpenNavigation}
              className="rounded p-1.5 text-white/70 hover:text-white md:hidden"
              aria-label={t("nav.open")}
            >
              <Menu className="h-5 w-5" />
            </button>
            <Volume2 className="h-5 w-5 shrink-0 text-white/70" />
            <h3 className="truncate text-base font-semibold">{roomName}</h3>
            {call.isEncrypted && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Lock className="h-3.5 w-3.5 shrink-0 text-white/60" aria-label={t("chat.encrypted")} />
                </TooltipTrigger>
                <TooltipContent>{t("chat.encrypted")}</TooltipContent>
              </Tooltip>
            )}
            {isReconnecting && (
              <span className="flex items-center gap-1.5 text-xs text-nx-idle">
                <Spinner className="h-3.5 w-3.5" /> {t("call.restoring")}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <TopBarButton label={isChatOpen ? t("call.hideChat") : t("call.showChat")} active={isChatOpen} onClick={() => setIsChatOpen((open) => !open)}>
              <MessageSquare className="h-5 w-5" />
            </TopBarButton>
            <TopBarButton label={isFullscreen ? t("call.exitFullscreen") : t("call.fullscreen")} onClick={toggleFullscreen}>
              {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
            </TopBarButton>
          </div>
        </header>

        <div className="flex flex-col items-center gap-2 px-4 empty:hidden">
          {call.isAudioBlocked && (
            <button
              onClick={() => void resumeAudio()}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Volume2 className="h-4 w-4" />
              {t("call.audioBlocked")}
            </button>
          )}
          <CallPermissionHint roomId={call.roomId} />
        </div>

        {/* Stage */}
        <div className="flex min-h-0 flex-1 flex-col px-2 pt-2 sm:px-4">
          {focused ? (
            <FocusView focused={focused} others={tiles.filter((tile) => tile !== focused)} onFocus={setFocusChoice} />
          ) : (
            <TileGrid tiles={tiles} onFocus={setFocusChoice} />
          )}
        </div>

        {/* Controls */}
        <div className="flex shrink-0 items-center justify-center gap-2 px-2 py-4 sm:gap-3">
          <ControlButton
            label={call.isCameraOn ? t("call.cameraOff") : t("call.cameraOn")}
            variant={call.isCameraOn ? "on" : "default"}
            onClick={() => void toggleCamera()}
          >
            {call.isCameraOn ? <Video className="h-6 w-6" /> : <VideoOff className="h-6 w-6" />}
          </ControlButton>
          <ScreenshareControl />
          <div className="mx-1 h-8 w-px bg-white/15 sm:mx-2" />
          <ControlButton
            label={isMicMuted ? t("call.unmuteMic") : t("call.muteMic")}
            variant={isMicMuted ? "off" : "default"}
            onClick={() => void toggleMicrophone()}
          >
            {isMicMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
          </ControlButton>
          <ControlButton
            label={isDeafened ? t("call.undeafen") : t("call.deafen")}
            variant={isDeafened ? "off" : "default"}
            onClick={toggleDeafen}
          >
            {isDeafened ? <HeadphoneOff className="h-6 w-6" /> : <Headphones className="h-6 w-6" />}
          </ControlButton>
          <ControlButton label={t("call.leave")} variant="danger" onClick={leaveCall}>
            <PhoneOff className="h-6 w-6" />
          </ControlButton>
        </div>
      </div>

      {/* Text chat of the room, next to the call (Discord's "chat in voice channels"). */}
      {isChatOpen && (
        <aside
          className="absolute inset-0 z-20 flex flex-col bg-background lg:static lg:w-[380px] lg:shrink-0 lg:border-l lg:border-nx-guild-bar"
          aria-label={t("call.chat")}
        >
          <div className="flex h-12 shrink-0 items-center justify-between gap-2 px-4 shadow-[0_1px_0_rgba(4,4,5,0.2)]">
            <div className="flex min-w-0 items-center gap-2">
              <MessageSquare className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="truncate font-semibold text-foreground">{roomName}</span>
            </div>
            <button
              onClick={() => setIsChatOpen(false)}
              className="rounded p-1 text-muted-foreground hover:text-foreground"
              aria-label={t("call.closeChat")}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <RoomChat roomId={call.roomId} compact />
        </aside>
      )}
    </div>
  )
}
