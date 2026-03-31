"use client"

import { useEffect, useRef, useState } from "react"
import { Headphones, Mic, MicOff, Phone, PhoneOff, ScreenShare, ScreenShareOff } from "lucide-react"
import { cn } from "@/lib/utils"

export interface CallParticipant {
  userId: string
  name: string
  screensharing: boolean
}

export interface CallVideoFeed {
  id: string
  userId: string
  name: string
  stream: MediaStream
  hasVideo: boolean
}

interface CallAreaProps {
  selfUserId: string
  participants: CallParticipant[]
  videoFeeds: CallVideoFeed[]
  localUserMediaStream: MediaStream | null
  isMicMuted: boolean
  isDeafened: boolean
  isScreensharing: boolean
  onToggleMic: () => void
  onToggleHeadphones: () => void
  onToggleScreenshare: () => void
  onLeaveCall: () => void
}

function VideoTile({ feed, isDeafened }: { feed: CallVideoFeed; isDeafened: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const element = videoRef.current
    if (!element) return

    element.srcObject = feed.stream
    const playPromise = element.play()
    if (playPromise) {
      playPromise.catch(() => {
        // Autoplay can be blocked by browser policy; user interaction then starts playback.
      })
    }

    return () => {
      element.srcObject = null
    }
  }, [feed.stream])

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-border bg-card">
      {feed.hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isDeafened}
          className="h-full w-full bg-black object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-muted text-sm text-muted-foreground">
          Keine Kamera
        </div>
      )}

      <div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs text-white">
        {feed.name}
      </div>
    </div>
  )
}

export function CallArea({
  selfUserId,
  participants,
  videoFeeds,
  localUserMediaStream,
  isMicMuted,
  isDeafened,
  isScreensharing,
  onToggleMic,
  onToggleHeadphones,
  onToggleScreenshare,
  onLeaveCall,
}: CallAreaProps) {
  const [speakingByUserId, setSpeakingByUserId] = useState<Record<string, boolean>>({})
  const featuredFeed = videoFeeds[0]
  const secondaryFeeds = videoFeeds.slice(1)

  useEffect(() => {
    const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) {
      return
    }

    const audioContext = new AudioContextCtor()
    const entries: Array<{
      userId: string
      source: MediaStreamAudioSourceNode
      analyser: AnalyserNode
      buffer: Uint8Array
    }> = []

    const addStream = (userId: string, stream: MediaStream, disabled: boolean = false) => {
      if (disabled) return
      if (stream.getAudioTracks().length === 0) return

      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.35
      source.connect(analyser)

      entries.push({
        userId,
        source,
        analyser,
        buffer: new Uint8Array(analyser.fftSize),
      })
    }

    videoFeeds.forEach((feed) => addStream(feed.userId, feed.stream))
    if (localUserMediaStream) {
      addStream(selfUserId, localUserMediaStream, isMicMuted)
    }

    if (entries.length === 0) {
      void audioContext.close()
      return
    }

    let rafId = 0
    let destroyed = false

    const loop = () => {
      const nextSpeakingByUser: Record<string, boolean> = {}

      entries.forEach((entry) => {
        entry.analyser.getByteTimeDomainData(entry.buffer)

        let sum = 0
        for (let i = 0; i < entry.buffer.length; i += 1) {
          const sample = (entry.buffer[i] - 128) / 128
          sum += sample * sample
        }

        const rms = Math.sqrt(sum / entry.buffer.length)
        const speaking = rms > 0.055
        nextSpeakingByUser[entry.userId] = Boolean(nextSpeakingByUser[entry.userId]) || speaking
      })

      setSpeakingByUserId((prev) => {
        const prevKeys = Object.keys(prev)
        const nextKeys = Object.keys(nextSpeakingByUser)
        if (prevKeys.length === nextKeys.length) {
          const unchanged = nextKeys.every((key) => prev[key] === nextSpeakingByUser[key])
          if (unchanged) return prev
        }
        return nextSpeakingByUser
      })

      if (!destroyed) {
        rafId = window.requestAnimationFrame(loop)
      }
    }

    rafId = window.requestAnimationFrame(loop)

    return () => {
      destroyed = true
      window.cancelAnimationFrame(rafId)
      entries.forEach((entry) => {
        entry.source.disconnect()
        entry.analyser.disconnect()
      })
      void audioContext.close()
    }
  }, [videoFeeds, localUserMediaStream, selfUserId, isMicMuted])

  return (
    <div className="flex flex-1 flex-col bg-[#1e1f22] p-4">
      <div className="mb-4 flex items-center justify-between rounded-xl border border-border/60 bg-[#2b2d31] px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20 text-primary">
            <Phone className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Voice Call aktiv</p>
            <p className="text-xs text-muted-foreground">{participants.length} Teilnehmer im Anruf</p>
          </div>
        </div>
        <span className="rounded-md bg-emerald-500/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
          Live
        </span>
      </div>

      <div className="flex min-h-0 flex-1 gap-4 lg:flex-row">
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="relative h-[46vh] min-h-[240px] overflow-hidden rounded-xl border border-border/60 bg-[#2b2d31]">
            {featuredFeed ? (
              <VideoTile feed={featuredFeed} isDeafened={isDeafened} />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
                Kein Video-Feed verfuegbar
              </div>
            )}
          </div>

          {secondaryFeeds.length > 0 && (
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
              {secondaryFeeds.map((feed) => (
                <div key={feed.id} className="h-28 overflow-hidden rounded-xl border border-border/60 bg-[#2b2d31]">
                  <VideoTile feed={feed} isDeafened={isDeafened} />
                </div>
              ))}
            </div>
          )}
        </div>

        <aside className="w-full rounded-xl border border-border/60 bg-[#2b2d31] p-3 lg:w-72">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Im Anruf</h4>
          <div className="space-y-2">
            {participants.map((participant) => (
              <div
                key={participant.userId}
                className={cn(
                  "flex items-center gap-3 rounded-lg bg-[#232428] px-3 py-2 transition-all",
                  speakingByUserId[participant.userId]
                    ? "ring-2 ring-emerald-400 shadow-[0_0_18px_rgba(16,185,129,0.45)]"
                    : "ring-1 ring-transparent",
                )}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
                  {participant.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{participant.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {participant.screensharing ? "Teilt Bildschirm" : "Sprache"}
                  </p>
                </div>
              </div>
            ))}

            {participants.length === 0 && (
              <div className="rounded-lg bg-[#232428] px-3 py-4 text-center text-sm text-muted-foreground">
                Du bist im Call. Warte auf weitere Teilnehmer...
              </div>
            )}
          </div>
        </aside>
      </div>

      <div className="mt-4 flex items-center justify-center gap-3 rounded-xl border border-border/60 bg-[#2b2d31] px-4 py-3">
        <button
          onClick={onToggleMic}
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full transition-colors",
            isMicMuted ? "bg-red-500 text-white hover:bg-red-600" : "bg-[#3a3c43] text-foreground hover:bg-[#4a4d55]",
          )}
          aria-label={isMicMuted ? "Mikrofon aktivieren" : "Mikrofon stummschalten"}
        >
          {isMicMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
        <button
          onClick={onToggleHeadphones}
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full transition-colors",
            isDeafened ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-[#3a3c43] text-foreground hover:bg-[#4a4d55]",
          )}
          aria-label={isDeafened ? "Audio aktivieren" : "Audio stummschalten"}
        >
          <Headphones className="h-4 w-4" />
        </button>
        <button
          onClick={onToggleScreenshare}
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full transition-colors",
            isScreensharing ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-[#3a3c43] text-foreground hover:bg-[#4a4d55]",
          )}
          aria-label={isScreensharing ? "Bildschirmfreigabe beenden" : "Bildschirm teilen"}
        >
          {isScreensharing ? <ScreenShareOff className="h-4 w-4" /> : <ScreenShare className="h-4 w-4" />}
        </button>
        <button
          onClick={onLeaveCall}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600"
          aria-label="Anruf verlassen"
        >
          <PhoneOff className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}






