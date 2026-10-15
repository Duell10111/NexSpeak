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
import { CallSession, type CallSnapshot } from "@/lib/matrix/call-session"
import { describeMatrixError } from "@/lib/matrix/errors"
import { CallPermissionError, enableCallsInRoom } from "@/lib/matrix/rtc"
import { getDefaultAudioSettings, loadAudioSettings, subscribeAudioSettings } from "@/lib/audio-settings"
import { useRtcCallInfo, type RoomCallInfo } from "@/hooks/useRtcCallInfo"

export type { RoomCallInfo }
export type { CallParticipant, CallVideoFeed } from "@/lib/matrix/call-session"

interface CallContextValue {
  /** Who is in a call, per room (any MatrixRTC client). */
  callInfoByRoom: Record<string, RoomCallInfo>
  /** Our own call, if any. */
  call: CallSnapshot | null
  /** Room we are currently connecting to. */
  joiningRoomId: string
  isInCallInActiveChannel: boolean
  joinCall: (roomId: string) => Promise<void>
  leaveCall: () => void
  toggleMicrophone: () => Promise<void>
  toggleCamera: () => Promise<void>
  toggleScreenshare: () => Promise<void>
  toggleDeafen: () => void
  resumeAudio: () => Promise<void>
}

const CallContext = createContext<CallContextValue | undefined>(undefined)

const noopSubscribe = () => () => {}
const nullSnapshot = () => null

interface CallProviderProps {
  client: MatrixClient | null
  activeChannelId: string
  children: ReactNode
}

function reportError(error: unknown, fallback: string) {
  console.error(fallback, error)
  const message =
    error instanceof DOMException && error.name === "NotAllowedError"
      ? "Zugriff verweigert. Bitte erlaube Mikrofon, Kamera bzw. Bildschirmfreigabe im Browser."
      : describeMatrixError(error, fallback)
  toast.error(message)
}

export function CallProvider({ client, activeChannelId, children }: CallProviderProps) {
  const [session, setSession] = useState<CallSession | null>(null)
  const [joiningRoomId, setJoiningRoomId] = useState("")
  const sessionRef = useRef<CallSession | null>(null)
  const callInfoByRoom = useRtcCallInfo(client)
  const audioSettings = useSyncExternalStore(subscribeAudioSettings, loadAudioSettings, getDefaultAudioSettings)

  const call = useSyncExternalStore(
    session ? session.subscribe : noopSubscribe,
    session ? session.getSnapshot : nullSnapshot,
    nullSnapshot,
  )

  const endSession = useCallback((ended: CallSession) => {
    if (sessionRef.current === ended) sessionRef.current = null
    setSession((current) => (current === ended ? null : current))
  }, [])

  const leaveCall = useCallback(() => {
    const current = sessionRef.current
    if (current) void current.leave()
  }, [])

  const joinCall = useCallback(
    async (roomId: string) => {
      if (!client || !roomId) return
      if (sessionRef.current?.roomId === roomId) return

      // Only one call at a time, like Discord.
      await sessionRef.current?.leave()
      setJoiningRoomId(roomId)
      try {
        const settings = loadAudioSettings()
        const next = await CallSession.start(client, roomId, {
          inputDeviceId: settings.inputDeviceId,
          outputDeviceId: settings.outputDeviceId,
          outputVolume: settings.outputVolume / 100,
        })
        next.onEnded = (reason) => {
          endSession(next)
          if (reason) toast.error(reason)
        }
        sessionRef.current = next
        setSession(next)
      } catch (error) {
        if (error instanceof CallPermissionError && error.canEnable) {
          // Admins can fix the room right away, like Element offers.
          toast.error(error.message, {
            duration: 15_000,
            action: {
              label: "Anrufe erlauben",
              onClick: () => {
                enableCallsInRoom(client, roomId)
                  .then(() => toast.success("Anrufe sind jetzt für alle Mitglieder erlaubt."))
                  .catch((enableError: unknown) => reportError(enableError, "Berechtigungen konnten nicht geändert werden."))
              },
            },
          })
        } else if (error instanceof CallPermissionError) {
          toast.error(error.message)
        } else {
          reportError(error, "Dem Sprachkanal konnte nicht beigetreten werden.")
        }
      } finally {
        setJoiningRoomId("")
      }
    },
    [client, endSession],
  )

  const toggleMicrophone = useCallback(async () => {
    const current = sessionRef.current
    if (!current) return
    try {
      const { isMicMuted, isDeafened } = current.getSnapshot()
      await current.setMicrophoneEnabled(isMicMuted)
      // Unmuting while deafened makes no sense (Discord behaviour): undeafen too.
      if (isMicMuted && isDeafened) current.setDeafened(false)
    } catch (error) {
      reportError(error, "Mikrofon konnte nicht umgeschaltet werden.")
    }
  }, [])

  const toggleCamera = useCallback(async () => {
    const current = sessionRef.current
    if (!current) return
    try {
      await current.setCameraEnabled(!current.getSnapshot().isCameraOn)
    } catch (error) {
      reportError(error, "Kamera konnte nicht umgeschaltet werden.")
    }
  }, [])

  const toggleScreenshare = useCallback(async () => {
    const current = sessionRef.current
    if (!current) return
    try {
      await current.setScreenShareEnabled(!current.getSnapshot().isScreensharing)
    } catch (error) {
      // Closing the browser's picker is not an error worth reporting.
      if (error instanceof DOMException && error.name === "NotAllowedError") return
      reportError(error, "Bildschirmfreigabe konnte nicht umgeschaltet werden.")
    }
  }, [])

  const toggleDeafen = useCallback(() => {
    const current = sessionRef.current
    if (!current) return
    const { isDeafened, isMicMuted } = current.getSnapshot()
    current.setDeafened(!isDeafened)
    if (!isDeafened && !isMicMuted) {
      current.setMicrophoneEnabled(false).catch((error: unknown) => console.warn("Failed to mute while deafening:", error))
    }
  }, [])

  const resumeAudio = useCallback(async () => {
    try {
      await sessionRef.current?.startAudio()
    } catch (error) {
      reportError(error, "Audio konnte nicht gestartet werden.")
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
      joiningRoomId,
      isInCallInActiveChannel: Boolean(call && call.roomId === activeChannelId),
      joinCall,
      leaveCall,
      toggleMicrophone,
      toggleCamera,
      toggleScreenshare,
      toggleDeafen,
      resumeAudio,
    }),
    [
      callInfoByRoom,
      call,
      joiningRoomId,
      activeChannelId,
      joinCall,
      leaveCall,
      toggleMicrophone,
      toggleCamera,
      toggleScreenshare,
      toggleDeafen,
      resumeAudio,
    ],
  )

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>
}

export function useCallContext(): CallContextValue {
  const context = useContext(CallContext)
  if (!context) {
    throw new Error("useCallContext must be used within CallProvider")
  }
  return context
}
