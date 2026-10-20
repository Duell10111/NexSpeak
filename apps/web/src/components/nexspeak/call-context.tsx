"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import type { MatrixClient } from "matrix-js-sdk"
import { toast } from "sonner"
import { CallSession, type CallSnapshot } from "@nexspeak/core/matrix/call-session"
import { describeMatrixError } from "@nexspeak/core/matrix/errors"
import { t } from "@nexspeak/i18n"
import { CallPermissionError, enableCallsInRoom } from "@nexspeak/core/matrix/rtc"
import {
  audioProcessingOptions,
  getDefaultAudioSettings,
  loadAudioSettings,
  subscribeAudioSettings,
} from "@/lib/audio-settings"
import { VideoPopout } from "@/lib/video-popout"
import { desktopBridge } from "@/lib/desktop"
import { useRtcCallInfo, type RoomCallInfo } from "@/hooks/useRtcCallInfo"
import {
  DEFAULT_SCREENSHARE_QUALITY,
  loadScreenShareQuality,
  saveScreenShareQuality,
  type ScreenShareQuality,
} from "@nexspeak/core/screenshare-quality"
import type { EncoderInfo } from "@nexspeak/core/video-codec"
import type { ConnectionInfo } from "@nexspeak/core/connection-stats"
import { ScreenshareDialog } from "@/components/nexspeak/screenshare-dialog"
import { DesktopSourcePicker } from "@/components/nexspeak/desktop-source-picker"
import { usePushToTalk } from "@/hooks/usePushToTalk"
import { createCallSoundPlayer, isCueEnabled } from "@/lib/call-sounds"
import { emptyCallShortcutBindings } from "@nexspeak/core/global-shortcuts"

export type { RoomCallInfo }
export type { CallParticipant, CallVideoFeed } from "@nexspeak/core/matrix/call-session"

interface CallContextValue {
  /** Who is in a call, per room (any MatrixRTC client). */
  callInfoByRoom: Record<string, RoomCallInfo>
  /** Our own call, if any. */
  call: CallSnapshot | null
  /** Keeps the one existing video element alive while browsing other channels. */
  videoPopout: VideoPopout
  /** Room we are currently connecting to. */
  joiningRoomId: string
  isInCallInActiveChannel: boolean
  /** Self-mute/deafen, also before joining (applied on join, like Discord). */
  isMicMuted: boolean
  isDeafened: boolean
  joinCall: (roomId: string) => Promise<void>
  leaveCall: () => void
  /** Ends our call in this room (including a join still in progress) and waits until it is left. */
  endCallIn: (roomId: string) => Promise<void>
  toggleMicrophone: () => Promise<void>
  toggleCamera: () => Promise<void>
  /** Stops a running screenshare, otherwise opens the quality dialog (like Discord's "Go Live"). */
  toggleScreenshare: () => Promise<void>
  /** Last chosen stream quality; applies to the next and the running screenshare. */
  screenShareQuality: ScreenShareQuality
  startScreenshare: (quality: ScreenShareQuality) => Promise<void>
  changeScreenShareQuality: (quality: ScreenShareQuality) => Promise<void>
  /** Stats sampler for the running screenshare's encoder (hardware or software, bitrate, limits). */
  createScreenShareEncoderSampler: () => (() => Promise<EncoderInfo | null>) | null
  /** Stats sampler for ping, packet loss and transport of the running call. */
  createConnectionSampler: () => (() => Promise<ConnectionInfo | null>) | null
  toggleDeafen: () => void
  resumeAudio: () => Promise<void>
  setParticipantVolume: (identity: string, volume: number) => void
  setParticipantMuted: (identity: string, muted: boolean) => void
  /** "Watch stream" / "Stop watching" for a remote screenshare. */
  setScreenshareWatched: (identity: string, watched: boolean) => void
}

const CallContext = createContext<CallContextValue | undefined>(undefined)

const noopSubscribe = () => () => {}
const nullSnapshot = () => null

const VOICE_PREFS_KEY = "nexspeak:voice-prefs"

interface VoicePrefs {
  muted: boolean
  deafened: boolean
  /** Muted only because of deafening: undeafening unmutes again (Discord behaviour). */
  mutedByDeafen: boolean
}

const DEFAULT_VOICE_PREFS: VoicePrefs = { muted: false, deafened: false, mutedByDeafen: false }

function loadVoicePrefs(): VoicePrefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(VOICE_PREFS_KEY) || "null") as Partial<VoicePrefs> | null
    return { ...DEFAULT_VOICE_PREFS, ...parsed }
  } catch {
    return DEFAULT_VOICE_PREFS
  }
}

function saveVoicePrefs(prefs: VoicePrefs): void {
  try {
    localStorage.setItem(VOICE_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Remembering mute across reloads is a convenience only.
  }
}

interface CallProviderProps {
  client: MatrixClient | null
  activeChannelId: string
  children: ReactNode
}

function reportError(error: unknown, fallback: string) {
  console.error(fallback, error)
  const message =
    error instanceof DOMException && error.name === "NotAllowedError"
      ? t("call.error.accessDenied")
      : describeMatrixError(error, fallback)
  toast.error(message)
}

export function CallProvider({ client, activeChannelId, children }: CallProviderProps) {
  const [session, setSession] = useState<CallSession | null>(null)
  const [joiningRoomId, setJoiningRoomId] = useState("")
  const [voicePrefs, setVoicePrefs] = useState<VoicePrefs>(() =>
    typeof window === "undefined" ? DEFAULT_VOICE_PREFS : loadVoicePrefs(),
  )
  const voicePrefsRef = useRef(voicePrefs)
  const [screenShareQuality, setScreenShareQuality] = useState<ScreenShareQuality>(() =>
    typeof window === "undefined" ? DEFAULT_SCREENSHARE_QUALITY : loadScreenShareQuality(),
  )
  const [isScreenshareDialogOpen, setIsScreenshareDialogOpen] = useState(false)
  const sessionRef = useRef<CallSession | null>(null)
  /** A room whose pending join was given up (e.g. the room is being left): the join ends itself. */
  const abandonedJoinRef = useRef("")
  const callInfoByRoom = useRtcCallInfo(client)
  const audioSettings = useSyncExternalStore(subscribeAudioSettings, loadAudioSettings, getDefaultAudioSettings)
  usePushToTalk(session, audioSettings)

  const call = useSyncExternalStore(
    session ? session.subscribe : noopSubscribe,
    session ? session.getSnapshot : nullSnapshot,
    nullSnapshot,
  )

  const [videoPopout] = useState(() => new VideoPopout())
  useEffect(() => {
    videoPopout.retain(call?.videoFeeds ?? [])
  }, [call, videoPopout])
  useEffect(() => () => videoPopout.destroy(), [videoPopout])

  const updateVoicePrefs = useCallback((next: VoicePrefs) => {
    voicePrefsRef.current = next
    setVoicePrefs(next)
    saveVoicePrefs(next)
  }, [])

  const endSession = useCallback((ended: CallSession) => {
    if (sessionRef.current === ended) sessionRef.current = null
    setSession((current) => (current === ended ? null : current))
  }, [])

  const leaveCall = useCallback(() => {
    const current = sessionRef.current
    if (current) void current.leave()
  }, [])

  const endCallIn = useCallback(async (roomId: string) => {
    abandonedJoinRef.current = roomId
    const current = sessionRef.current
    if (current?.roomId === roomId) await current.leave()
  }, [])

  const joinCall = useCallback(
    async (roomId: string) => {
      if (!client || !roomId) return
      if (sessionRef.current?.roomId === roomId) return

      // Only one call at a time, like Discord.
      await sessionRef.current?.leave()
      abandonedJoinRef.current = ""
      setJoiningRoomId(roomId)
      try {
        const settings = loadAudioSettings()
        const sounds = createCallSoundPlayer()
        const next = await CallSession.start(client, roomId, {
          inputDeviceId: settings.inputDeviceId,
          outputDeviceId: settings.outputDeviceId,
          outputVolume: settings.outputVolume / 100,
          startMuted: voicePrefsRef.current.muted,
          startDeafened: voicePrefsRef.current.deafened,
          pushToTalk: settings.inputMode === "push-to-talk",
          processing: audioProcessingOptions(settings),
          onCue: (cue) => {
            const current = loadAudioSettings()
            if (!isCueEnabled(current, cue)) return
            sounds.play(cue, { volume: current.outputVolume / 100, outputDeviceId: current.outputDeviceId })
          },
        })
        if (abandonedJoinRef.current === roomId) {
          await next.leave()
          return
        }
        next.onEnded = (reason) => {
          endSession(next)
          if (reason) toast.error(reason)
        }
        sessionRef.current = next
        setSession(next)
      } catch (error) {
        if (abandonedJoinRef.current === roomId) return
        if (error instanceof CallPermissionError && error.canEnable) {
          // Admins can fix the room right away, like Element offers.
          toast.error(error.message, {
            duration: 15_000,
            action: {
              label: t("call.allowCalls"),
              onClick: () => {
                enableCallsInRoom(client, roomId)
                  .then(() => toast.success(t("call.callsEnabled")))
                  .catch((enableError: unknown) => reportError(enableError, t("call.permissionsFailed")))
              },
            },
          })
        } else if (error instanceof CallPermissionError) {
          toast.error(error.message)
        } else {
          reportError(error, t("call.error.joinFailed"))
        }
      } finally {
        setJoiningRoomId("")
      }
    },
    [client, endSession],
  )

  const toggleMicrophone = useCallback(async () => {
    const current = sessionRef.current
    const prefs = voicePrefsRef.current
    const isMuted = current ? current.getSnapshot().isMicMuted : prefs.muted
    const isDeafened = current ? current.getSnapshot().isDeafened : prefs.deafened
    try {
      await current?.setMicrophoneEnabled(isMuted)
      // Unmuting while deafened makes no sense (Discord behaviour): undeafen too.
      if (isMuted && isDeafened) current?.setDeafened(false)
      updateVoicePrefs({ muted: !isMuted, deafened: isMuted ? false : isDeafened, mutedByDeafen: false })
    } catch (error) {
      reportError(error, t("call.error.micToggleFailed"))
    }
  }, [updateVoicePrefs])

  const toggleCamera = useCallback(async () => {
    const current = sessionRef.current
    if (!current) return
    try {
      await current.setCameraEnabled(!current.getSnapshot().isCameraOn)
    } catch (error) {
      reportError(error, t("call.error.cameraToggleFailed"))
    }
  }, [])

  const toggleScreenshare = useCallback(async () => {
    const current = sessionRef.current
    if (!current) return
    if (!current.getSnapshot().isScreensharing) {
      setIsScreenshareDialogOpen(true)
      return
    }
    try {
      await current.setScreenShareEnabled(false)
    } catch (error) {
      reportError(error, t("call.error.screenshareStopFailed"))
    }
  }, [])

  const createScreenShareEncoderSampler = useCallback(
    () => sessionRef.current?.createScreenShareEncoderSampler() ?? null,
    [],
  )

  const createConnectionSampler = useCallback(() => sessionRef.current?.createConnectionSampler() ?? null, [])

  const updateScreenShareQuality = useCallback((quality: ScreenShareQuality) => {
    setScreenShareQuality(quality)
    saveScreenShareQuality(quality)
  }, [])

  const startScreenshare = useCallback(
    async (quality: ScreenShareQuality) => {
      setIsScreenshareDialogOpen(false)
      updateScreenShareQuality(quality)
      const current = sessionRef.current
      if (!current) return
      try {
        const bridge = desktopBridge()
        const shareAudio = loadAudioSettings().shareSystemAudio && (!bridge || bridge.supportsSystemAudio)
        await current.setScreenShareEnabled(true, quality, shareAudio)
      } catch (error) {
        // Closing the browser's picker is not an error worth reporting.
        if (error instanceof DOMException && error.name === "NotAllowedError") return
        reportError(error, t("call.error.screenshareStartFailed"))
      }
    },
    [updateScreenShareQuality],
  )

  const changeScreenShareQuality = useCallback(
    async (quality: ScreenShareQuality) => {
      updateScreenShareQuality(quality)
      try {
        await sessionRef.current?.setScreenShareQuality(quality)
      } catch (error) {
        reportError(error, t("call.error.qualityFailed"))
      }
    },
    [updateScreenShareQuality],
  )

  const toggleDeafen = useCallback(() => {
    const current = sessionRef.current
    const prefs = voicePrefsRef.current
    const isDeafened = current ? current.getSnapshot().isDeafened : prefs.deafened
    const isMuted = current ? current.getSnapshot().isMicMuted : prefs.muted

    if (!isDeafened) {
      // Deafening also mutes; remember whether we did that, to undo it again.
      current?.setDeafened(true)
      if (!isMuted) {
        current?.setMicrophoneEnabled(false).catch((error: unknown) => console.warn("Failed to mute while deafening:", error))
      }
      updateVoicePrefs({ muted: true, deafened: true, mutedByDeafen: !isMuted })
    } else {
      current?.setDeafened(false)
      const unmute = prefs.mutedByDeafen
      if (unmute) {
        current?.setMicrophoneEnabled(true).catch((error: unknown) => reportError(error, t("call.error.micEnableFailed")))
      }
      updateVoicePrefs({ muted: unmute ? false : isMuted, deafened: false, mutedByDeafen: false })
    }
  }, [updateVoicePrefs])

  // Bindings only reach the main process while a session can handle them: a registered key is
  // swallowed system-wide, so it must not be taken while joining or after the session is gone.
  const hasSession = session !== null
  useEffect(() => {
    const bridge = desktopBridge()
    if (!bridge) return
    void bridge.setCallShortcuts(
      hasSession ? audioSettings.callShortcuts : emptyCallShortcutBindings(),
      audioSettings.inputMode === "push-to-talk" ? audioSettings.pushToTalkKey : null,
    )
  }, [hasSession, audioSettings.callShortcuts, audioSettings.inputMode, audioSettings.pushToTalkKey])

  useEffect(() => {
    if (!session) return
    return desktopBridge()?.onCallShortcut((action) => {
      if (action === "toggle-mute") void toggleMicrophone()
      else if (action === "toggle-deafen") toggleDeafen()
      else if (action === "leave-call") leaveCall()
      else if (action === "stop-screen-share" && session.getSnapshot().isScreensharing) {
        session.setScreenShareEnabled(false).catch((error: unknown) => reportError(error, t("call.error.screenshareStopFailed")))
      }
    })
  }, [session, toggleMicrophone, toggleDeafen, leaveCall])

  const setParticipantVolume = useCallback((identity: string, volume: number) => {
    sessionRef.current?.setParticipantVolume(identity, volume)
  }, [])

  const setParticipantMuted = useCallback((identity: string, muted: boolean) => {
    sessionRef.current?.setParticipantMuted(identity, muted)
  }, [])

  const setScreenshareWatched = useCallback((identity: string, watched: boolean) => {
    sessionRef.current?.setScreenshareWatched(identity, watched)
  }, [])

  const resumeAudio = useCallback(async () => {
    try {
      await sessionRef.current?.startAudio()
    } catch (error) {
      reportError(error, t("call.error.audioFailed"))
    }
  }, [])

  // Apply device and volume preferences to a running call.
  useEffect(() => {
    if (!session) return
    session.setOutputVolume(audioSettings.outputVolume / 100)
  }, [session, audioSettings.outputVolume])

  useEffect(() => {
    if (!session) return
    session.setDevice("audioinput", audioSettings.inputDeviceId).catch((error: unknown) => {
      console.warn("Failed to switch microphone:", error)
    })
  }, [session, audioSettings.inputDeviceId])

  useEffect(() => {
    if (!session) return
    session.setDevice("audiooutput", audioSettings.outputDeviceId).catch((error: unknown) => {
      console.warn("Failed to switch audio output:", error)
    })
  }, [session, audioSettings.outputDeviceId])

  const { noiseSuppression, echoCancellation, autoGainControl, voiceGateDb } = audioProcessingOptions(audioSettings)
  useEffect(() => {
    if (!session) return
    void session.setAudioProcessing({ noiseSuppression, echoCancellation, autoGainControl, voiceGateDb })
  }, [session, noiseSuppression, echoCancellation, autoGainControl, voiceGateDb])

  // Leave when the tab closes; the delayed leave event on the server covers crashes.
  useEffect(() => {
    const onPageHide = () => sessionRef.current?.leave()
    window.addEventListener("pagehide", onPageHide)
    return () => window.removeEventListener("pagehide", onPageHide)
  }, [])

  // Leave the call when the provider goes away (logout).
  useEffect(() => () => void sessionRef.current?.leave(), [])

  const value = useMemo<CallContextValue>(
    () => ({
      callInfoByRoom,
      call,
      videoPopout,
      joiningRoomId,
      isInCallInActiveChannel: Boolean(call && call.roomId === activeChannelId),
      isMicMuted: call ? call.isMicMuted : voicePrefs.muted,
      isDeafened: call ? call.isDeafened : voicePrefs.deafened,
      joinCall,
      leaveCall,
      endCallIn,
      toggleMicrophone,
      toggleCamera,
      toggleScreenshare,
      screenShareQuality,
      startScreenshare,
      changeScreenShareQuality,
      createScreenShareEncoderSampler,
      createConnectionSampler,
      toggleDeafen,
      resumeAudio,
      setParticipantVolume,
      setParticipantMuted,
      setScreenshareWatched,
    }),
    [
      voicePrefs,
      callInfoByRoom,
      call,
      videoPopout,
      joiningRoomId,
      activeChannelId,
      joinCall,
      leaveCall,
      endCallIn,
      toggleMicrophone,
      toggleCamera,
      toggleScreenshare,
      screenShareQuality,
      startScreenshare,
      changeScreenShareQuality,
      createScreenShareEncoderSampler,
      createConnectionSampler,
      toggleDeafen,
      resumeAudio,
      setParticipantVolume,
      setParticipantMuted,
      setScreenshareWatched,
    ],
  )

  return (
    <CallContext.Provider value={value}>
      {children}
      <ScreenshareDialog
        open={isScreenshareDialogOpen && Boolean(call)}
        onOpenChange={setIsScreenshareDialogOpen}
        initialQuality={screenShareQuality}
        onStart={(quality) => void startScreenshare(quality)}
      />
      <DesktopSourcePicker />
    </CallContext.Provider>
  )
}

export function useCallContext(): CallContextValue {
  const context = useContext(CallContext)
  if (!context) {
    throw new Error("useCallContext must be used within CallProvider")
  }
  return context
}
