"use client"

import { useEffect, useRef, useState } from "react"
import { EventType } from "matrix-js-sdk"
import { toast } from "sonner"
import {
  Headphones,
  HeadphoneOff,
  Lock,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  ScreenShareOff,
  Video,
  VideoOff,
  Volume2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { MatrixAvatar } from "@/components/nexspeak/matrix-avatar"
import { useCallContext, type CallParticipant, type CallVideoFeed } from "@/components/nexspeak/call-context"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { enableCallsInRoom, membersCanJoinCalls } from "@/lib/matrix/rtc"
import { describeMatrixError } from "@/lib/matrix/errors"

function VideoTile({ feed, className }: { feed: CallVideoFeed; className?: string }) {
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
    <div className={cn("relative overflow-hidden rounded-xl border border-border bg-black", className)}>
      {/* Audio is played through LiveKit's own audio elements; video stays muted. */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={cn("h-full w-full", feed.isScreenshare ? "object-contain" : "object-cover", feed.isLocal && !feed.isScreenshare && "-scale-x-100")}
      />
      <div className="absolute bottom-2 left-2 flex items-center gap-2 rounded bg-black/60 px-2 py-1 text-xs text-white">
        <span>{feed.isLocal ? "Du" : feed.name}</span>
        {feed.isScreenshare && (
          <span className="rounded bg-white/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">Bildschirm</span>
        )}
      </div>
    </div>
  )
}

function ParticipantTile({ participant }: { participant: CallParticipant }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg bg-secondary px-3 py-2 transition-shadow",
        participant.isSpeaking && !participant.isMicMuted
          ? "ring-2 ring-nx-online shadow-[0_0_14px_rgba(35,165,90,0.45)]"
          : "ring-1 ring-transparent",
        participant.isConnecting && "opacity-60",
      )}
    >
      <MatrixAvatar mxcUrl={participant.avatarMxc} name={participant.name} size={32} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {participant.name}
          {participant.isLocal && <span className="text-muted-foreground"> (du)</span>}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {participant.isConnecting ? "Verbindet…" : participant.isScreensharing ? "Teilt Bildschirm" : "Sprachkanal"}
        </p>
      </div>
      {participant.isMicMuted && !participant.isConnecting && (
        <MicOff className="h-4 w-4 shrink-0 text-destructive" aria-label="Stummgeschaltet" />
      )}
    </div>
  )
}

/** Admins learn that other members can't join yet, and can fix it in one click. */
function CallPermissionHint({ roomId }: { roomId: string }) {
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
      toast.success("Anrufe sind jetzt für alle Mitglieder erlaubt.")
    } catch (error) {
      toast.error(describeMatrixError(error, "Berechtigungen konnten nicht geändert werden."))
    } finally {
      setIsEnabling(false)
    }
  }

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-nx-idle/40 bg-nx-idle/10 px-4 py-2 text-sm text-foreground">
      <span>Andere Mitglieder dürfen diesem Sprachkanal noch nicht beitreten.</span>
      <button
        onClick={() => void enable()}
        disabled={isEnabling}
        className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        Für alle erlauben
      </button>
    </div>
  )
}

function ControlButton({
  label,
  active,
  danger,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  danger?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-full transition-colors",
            danger
              ? "bg-destructive text-white hover:bg-destructive/90"
              : active
                ? "bg-foreground text-background hover:bg-foreground/90"
                : "bg-muted text-foreground hover:bg-nx-hover",
          )}
          aria-label={label}
          aria-pressed={active}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function CallArea() {
  const { call, toggleMicrophone, toggleDeafen, toggleCamera, toggleScreenshare, leaveCall, resumeAudio } = useCallContext()
  if (!call) return null

  const [featuredFeed, ...otherFeeds] = call.videoFeeds
  const connectedCount = call.participants.filter((participant) => !participant.isConnecting).length

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-nx-guild-bar p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-secondary px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            {call.connectionState === "reconnecting" ? "Verbindung wird wiederhergestellt…" : "Sprachkanal verbunden"}
            {call.isEncrypted && <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label="Ende-zu-Ende-verschlüsselt" />}
          </p>
          <p className="text-xs text-muted-foreground">
            {connectedCount} {connectedCount === 1 ? "Teilnehmer" : "Teilnehmer"}
          </p>
        </div>
        {call.connectionState === "reconnecting" ? (
          <Spinner className="h-4 w-4 text-muted-foreground" />
        ) : (
          <span className="rounded-md bg-nx-online/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-nx-online">
            Live
          </span>
        )}
      </div>

      <CallPermissionHint roomId={call.roomId} />

      {call.isAudioBlocked && (
        <button
          onClick={() => void resumeAudio()}
          className="mb-3 flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Volume2 className="h-4 w-4" />
          Der Browser hat die Wiedergabe blockiert – klicke hier, um die anderen zu hören
        </button>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        {featuredFeed && (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <VideoTile feed={featuredFeed} className="min-h-[200px] flex-1" />
            {otherFeeds.length > 0 && (
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                {otherFeeds.map((feed) => (
                  <VideoTile key={feed.id} feed={feed} className="h-28" />
                ))}
              </div>
            )}
          </div>
        )}

        <aside
          className={cn(
            "overflow-y-auto rounded-xl border border-border/60 bg-nx-member-bg p-3",
            featuredFeed ? "w-full lg:w-72" : "flex-1",
          )}
        >
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Im Anruf</h4>
          <div className={cn("grid gap-2", !featuredFeed && "sm:grid-cols-2 xl:grid-cols-3")}>
            {call.participants.map((participant) => (
              <ParticipantTile key={participant.identity} participant={participant} />
            ))}
          </div>
        </aside>
      </div>

      <div className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-border/60 bg-secondary px-4 py-3 sm:gap-3">
        <ControlButton
          label={call.isMicMuted ? "Mikrofon aktivieren" : "Mikrofon stummschalten"}
          active={call.isMicMuted}
          onClick={() => void toggleMicrophone()}
        >
          {call.isMicMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </ControlButton>
        <ControlButton
          label={call.isDeafened ? "Ton aktivieren" : "Ton stummschalten"}
          active={call.isDeafened}
          onClick={toggleDeafen}
        >
          {call.isDeafened ? <HeadphoneOff className="h-5 w-5" /> : <Headphones className="h-5 w-5" />}
        </ControlButton>
        <ControlButton
          label={call.isCameraOn ? "Kamera ausschalten" : "Kamera einschalten"}
          active={call.isCameraOn}
          onClick={() => void toggleCamera()}
        >
          {call.isCameraOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
        </ControlButton>
        <ControlButton
          label={call.isScreensharing ? "Bildschirmfreigabe beenden" : "Bildschirm teilen"}
          active={call.isScreensharing}
          onClick={() => void toggleScreenshare()}
        >
          {call.isScreensharing ? <ScreenShareOff className="h-5 w-5" /> : <MonitorUp className="h-5 w-5" />}
        </ControlButton>
        <ControlButton label="Anruf verlassen" danger onClick={leaveCall}>
          <PhoneOff className="h-5 w-5" />
        </ControlButton>
      </div>
    </div>
  )
}
