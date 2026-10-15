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
import { startOrJoinVoiceGroupCall } from "@/lib/matrix/client"
import {
  getDefaultAudioSettings,
  loadAudioSettings,
  subscribeAudioSettings,
} from "@/lib/audio-settings"

export interface RoomCallInfo {
  names: string[]
}

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
  isScreenshare: boolean
}

interface CallFeedLike {
  userId?: string
  stream?: MediaStream
  isLocal?: () => boolean
  getMember?: () => { name?: string } | null
}

interface GroupCallLike {
  state?: string
  creationTs?: number | null
  room?: { roomId?: string }
  participants?: Map<unknown, Map<string, unknown>>
  userMediaFeeds?: CallFeedLike[]
  screenshareFeeds?: CallFeedLike[]
  hasLocalParticipant?: () => boolean
  isMicrophoneMuted?: () => boolean
  isScreensharing?: () => boolean
  setMicrophoneMuted?: (muted: boolean) => Promise<boolean>
  setScreensharingEnabled?: (enabled: boolean) => Promise<boolean>
  cleanMemberState?: () => Promise<void>
  leave?: () => void
  on?: (event: string, listener: (...args: unknown[]) => void) => void
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void
}

function getVoipClient(client: MatrixClient) {
  return client as unknown as {
    getGroupCallForRoom?: (roomId: string) => GroupCallLike | null
    on?: (event: string, listener: (...args: unknown[]) => void) => void
    removeListener?: (event: string, listener: (...args: unknown[]) => void) => void
  }
}

function getJoinedLocalCalls(client: MatrixClient): GroupCallLike[] {
  const voipClient = getVoipClient(client)
  const callsByRoom = new Map<string, GroupCallLike>()

  client.getRooms().forEach((room) => {
    const call = voipClient.getGroupCallForRoom?.(room.roomId) || null
    const roomId = call?.room?.roomId
    if (!call || !roomId) return
    if (call.state === "ended") return
    if (!(call.hasLocalParticipant?.() ?? false)) return

    callsByRoom.set(roomId, call)
  })

  return Array.from(callsByRoom.values())
}

interface CallContextValue {
  selfUserId: string
  callInfoByRoom: Record<string, RoomCallInfo>
  activeCall: GroupCallLike | null
  activeCallRoomId: string
  isInCallInActiveChannel: boolean
  callParticipants: CallParticipant[]
  callVideoFeeds: CallVideoFeed[]
  localUserMediaStream: MediaStream | null
  isMicMuted: boolean
  isScreensharing: boolean
  isDeafened: boolean
  joinCall: (roomId: string) => Promise<void>
  leaveActiveCall: () => void
  toggleMicrophone: () => Promise<void>
  toggleScreenshare: () => Promise<void>
  toggleHeadphones: () => void
}

const CallContext = createContext<CallContextValue | undefined>(undefined)

function toCallParticipants(groupCall: GroupCallLike | null): CallParticipant[] {
  if (!groupCall?.participants) return []

  const byUser = new Map<string, CallParticipant>()

  groupCall.participants.forEach((deviceStates, member) => {
    if (!member || typeof member !== "object") return

    const memberObj = member as { userId?: string; name?: string }
    const userId = memberObj.userId
    if (!userId) return

    let screensharing = false
    deviceStates.forEach((state) => {
      if (state && typeof state === "object" && "screensharing" in state) {
        screensharing = screensharing || Boolean((state as { screensharing?: boolean }).screensharing)
      }
    })

    const current = byUser.get(userId)
    byUser.set(userId, {
      userId,
      name: memberObj.name || userId,
      screensharing: current ? current.screensharing || screensharing : screensharing,
    })
  })

  return Array.from(byUser.values()).sort((a, b) => a.name.localeCompare(b.name))
}

function toCallVideoFeeds(groupCall: GroupCallLike | null): CallVideoFeed[] {
  if (!groupCall?.userMediaFeeds && !groupCall?.screenshareFeeds) return []

  const mapFeeds = (feeds: CallFeedLike[] | undefined, isScreenshare: boolean): CallVideoFeed[] => {
    if (!feeds) return []

    return feeds
      .filter((feed) => !feed.isLocal?.())
      .filter((feed): feed is CallFeedLike & { stream: MediaStream; userId: string } => Boolean(feed.stream && feed.userId))
      .map((feed, index) => ({
        id: `${isScreenshare ? 'ss' : 'cam'}-${feed.userId}-${index}`,
        userId: feed.userId,
        name: feed.getMember?.()?.name || feed.userId,
        stream: feed.stream,
        hasVideo: feed.stream.getVideoTracks().length > 0,
        isScreenshare,
      }))
  }

  return [
    ...mapFeeds(groupCall.screenshareFeeds, true),
    ...mapFeeds(groupCall.userMediaFeeds, false),
  ]
}

function toRoomCallInfo(call: GroupCallLike | null): RoomCallInfo | null {
  if (!call || call.state === "ended") return null

  // Some SDK states can exist before a real room call is actually active.
  // Only surface a call badge when we have evidence of a real call instance.
  const hasCreationTs = typeof call.creationTs === "number"
  const hasParticipants = (call.participants?.size || 0) > 0
  const isEntered = call.state === "entered"
  if (!hasCreationTs && !hasParticipants && !isEntered) {
    return null
  }

  const names = new Set<string>()
  call.participants?.forEach((_, member) => {
    if (!member || typeof member !== "object") return
    const memberObj = member as { name?: string; userId?: string }
    names.add(memberObj.name || memberObj.userId || "Unbekannt")
  })

  const normalizedNames = Array.from(names).sort((a, b) => a.localeCompare(b))
  return { names: normalizedNames }
}

function areRoomCallInfosEqual(
  prev: Record<string, RoomCallInfo>,
  next: Record<string, RoomCallInfo>,
): boolean {
  const prevKeys = Object.keys(prev)
  const nextKeys = Object.keys(next)
  if (prevKeys.length !== nextKeys.length) return false

  return nextKeys.every((key) => {
    const prevNames = prev[key]?.names || []
    const nextNames = next[key]?.names || []
    return (
      prevNames.length === nextNames.length &&
      prevNames.every((name, idx) => name === nextNames[idx])
    )
  })
}

interface CallProviderProps {
  client: MatrixClient | null
  activeChannelId: string
  children: ReactNode
}

export function CallProvider({ client, activeChannelId, children }: CallProviderProps) {
  const lastUnknownDeviceRecoveryAtRef = useRef(0)
  const remoteAudioElementRef = useRef<HTMLAudioElement | null>(null)
  const remoteAudioTrackKeyRef = useRef("")
  const [activeCall, setActiveCall] = useState<GroupCallLike | null>(null)
  const [callInfoByRoom, setCallInfoByRoom] = useState<Record<string, RoomCallInfo>>({})
  const [callParticipants, setCallParticipants] = useState<CallParticipant[]>([])
  const [callVideoFeeds, setCallVideoFeeds] = useState<CallVideoFeed[]>([])
  const [localUserMediaStream, setLocalUserMediaStream] = useState<MediaStream | null>(null)
  const [isMicMuted, setIsMicMuted] = useState(false)
  const [isScreensharing, setIsScreensharing] = useState(false)
  const [isDeafened, setIsDeafened] = useState(false)
  const audioSettings = useSyncExternalStore(subscribeAudioSettings, loadAudioSettings, getDefaultAudioSettings)

  const syncRoomCallInfo = useCallback(() => {
    if (!client) {
      setCallInfoByRoom({})
      return
    }

    const voipClient = getVoipClient(client)

    const next: Record<string, RoomCallInfo> = {}
    client.getRooms().forEach((room) => {
      const info = toRoomCallInfo(voipClient.getGroupCallForRoom?.(room.roomId) || null)
      if (info) {
        next[room.roomId] = info
      }
    })

    setCallInfoByRoom((prev) => (areRoomCallInfosEqual(prev, next) ? prev : next))
  }, [client])

  const syncActiveChannelCall = useCallback(() => {
    if (!client || !activeChannelId) {
      setActiveCall(null)
      setCallParticipants([])
      setCallVideoFeeds([])
      setLocalUserMediaStream(null)
      setIsMicMuted(false)
      setIsScreensharing(false)
      return
    }

    const voipClient = getVoipClient(client)

    const groupCall = voipClient.getGroupCallForRoom?.(activeChannelId) || null
    const isCurrentChannelCall = groupCall?.room?.roomId === activeChannelId
    const isLocalParticipant = groupCall?.hasLocalParticipant?.() ?? false
    const scopedCall = isCurrentChannelCall && isLocalParticipant ? groupCall : null

    setActiveCall(scopedCall)
    setCallParticipants(toCallParticipants(scopedCall))
    setCallVideoFeeds(toCallVideoFeeds(scopedCall))
    setLocalUserMediaStream(
      scopedCall?.userMediaFeeds?.find((feed) => feed.isLocal?.())?.stream || null,
    )
    setIsMicMuted(scopedCall?.isMicrophoneMuted?.() ?? false)
    setIsScreensharing(scopedCall?.isScreensharing?.() ?? false)
  }, [client, activeChannelId])

  useEffect(() => {
    if (!client) return

    const voipClient = getVoipClient(client)

    const refresh = () => {
      syncRoomCallInfo()
      syncActiveChannelCall()
    }

    refresh()

    voipClient.on?.("GroupCall.incoming", refresh)
    voipClient.on?.("GroupCall.outgoing", refresh)
    voipClient.on?.("GroupCall.ended", refresh)
    voipClient.on?.("GroupCall.participants", refresh)

    return () => {
      voipClient.removeListener?.("GroupCall.incoming", refresh)
      voipClient.removeListener?.("GroupCall.outgoing", refresh)
      voipClient.removeListener?.("GroupCall.ended", refresh)
      voipClient.removeListener?.("GroupCall.participants", refresh)
    }
  }, [client, syncRoomCallInfo, syncActiveChannelCall])

  useEffect(() => {
    if (!activeCall?.on || !activeCall.removeListener) return

    const refreshActive = () => {
      if (activeCall.cleanMemberState) {
        void activeCall.cleanMemberState().catch((error) => {
          console.warn("Failed to clean group call member state on update:", error)
        })
      }

      setCallParticipants(toCallParticipants(activeCall))
      setCallVideoFeeds(toCallVideoFeeds(activeCall))
      setLocalUserMediaStream(
        activeCall.userMediaFeeds?.find((feed) => feed.isLocal?.())?.stream || null,
      )
      setIsMicMuted(activeCall.isMicrophoneMuted?.() ?? false)
      setIsScreensharing(activeCall.isScreensharing?.() ?? false)
      syncRoomCallInfo()
    }

    activeCall.on("participants_changed", refreshActive)
    activeCall.on("group_call_state_changed", refreshActive)
    activeCall.on("user_media_feeds_changed", refreshActive)
    activeCall.on("screenshare_feeds_changed", refreshActive)
    activeCall.on("calls_changed", refreshActive)
    activeCall.on("local_mute_state_changed", refreshActive)
    activeCall.on("local_screenshare_state_changed", refreshActive)

    const onGroupCallError = (error: unknown) => {
      if (!(error instanceof Error)) return
      if (!error.message.includes("No device found")) return

      const now = Date.now()
      if (now - lastUnknownDeviceRecoveryAtRef.current < 2000) return
      lastUnknownDeviceRecoveryAtRef.current = now

      if (activeCall.cleanMemberState) {
        void activeCall.cleanMemberState().catch((cleanupError) => {
          console.warn("Failed to clean member state after unknown device error:", cleanupError)
        })
      }

      syncRoomCallInfo()
      syncActiveChannelCall()
    }

    activeCall.on("group_call_error", onGroupCallError)
    refreshActive()

    // Existing calls (especially with already running screenshare) can populate feeds slightly later.
    // Re-sync briefly after join so remote screenshare appears without requiring a rejoin.
    const retry1 = window.setTimeout(refreshActive, 250)
    const retry2 = window.setTimeout(refreshActive, 900)
    const retry3 = window.setTimeout(refreshActive, 1800)

    return () => {
      window.clearTimeout(retry1)
      window.clearTimeout(retry2)
      window.clearTimeout(retry3)
      activeCall.removeListener?.("participants_changed", refreshActive)
      activeCall.removeListener?.("group_call_state_changed", refreshActive)
      activeCall.removeListener?.("user_media_feeds_changed", refreshActive)
      activeCall.removeListener?.("screenshare_feeds_changed", refreshActive)
      activeCall.removeListener?.("calls_changed", refreshActive)
      activeCall.removeListener?.("local_mute_state_changed", refreshActive)
      activeCall.removeListener?.("local_screenshare_state_changed", refreshActive)
      activeCall.removeListener?.("group_call_error", onGroupCallError)
    }
  }, [activeCall, syncRoomCallInfo, syncActiveChannelCall])

  // Play all remote voice feeds through one hidden audio element.
  // The tracks belong to the peer connections, so they must never be stopped here.
  useEffect(() => {
    const audioElement = remoteAudioElementRef.current
    if (!audioElement) return

    const remoteAudioTracks = callVideoFeeds
      .filter((feed) => !feed.isScreenshare)
      .flatMap((feed) => feed.stream.getAudioTracks())

    // Feeds are re-mapped on every call update; only swap the stream when the tracks changed,
    // otherwise playback would glitch on each refresh.
    const trackKey = remoteAudioTracks.map((track) => track.id).sort().join(",")
    if (trackKey === remoteAudioTrackKeyRef.current) return
    remoteAudioTrackKeyRef.current = trackKey

    if (remoteAudioTracks.length === 0) {
      audioElement.srcObject = null
      return
    }

    audioElement.srcObject = new MediaStream(remoteAudioTracks)
    audioElement.play().catch((error: unknown) => {
      // Autoplay can be blocked until the user interacts with the page.
      console.warn("Remote audio playback was blocked:", error)
    })
  }, [callVideoFeeds])

  // Apply deafen state, output volume and output device without restarting playback.
  useEffect(() => {
    const audioElement = remoteAudioElementRef.current
    if (!audioElement) return

    audioElement.muted = isDeafened
    audioElement.volume = audioSettings.outputVolume / 100

    const sinkCapable = audioElement as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
    if (sinkCapable.setSinkId) {
      sinkCapable.setSinkId(audioSettings.outputDeviceId).catch((error: unknown) => {
        console.warn("Failed to switch audio output device:", error)
      })
    }
  }, [isDeafened, audioSettings.outputVolume, audioSettings.outputDeviceId])

  // Use the preferred microphone for calls.
  useEffect(() => {
    if (!client) return
    client
      .getMediaHandler()
      .setAudioInput(audioSettings.inputDeviceId)
      .catch((error: unknown) => console.warn("Failed to switch microphone:", error))
  }, [client, audioSettings.inputDeviceId])

  // Leave the call when the tab is closed so others don't see a ghost participant.
  useEffect(() => {
    if (!client) return
    const onPageHide = () => {
      getJoinedLocalCalls(client).forEach((call) => call.leave?.())
    }
    window.addEventListener("pagehide", onPageHide)
    return () => window.removeEventListener("pagehide", onPageHide)
  }, [client])

  const joinCall = useCallback(async (roomId: string) => {
    if (!client || !roomId) return

    const joinedCalls = getJoinedLocalCalls(client)
    const existingInTarget = joinedCalls.find((call) => call.room?.roomId === roomId)

    // Ensure only one joined channel call at a time.
    joinedCalls
      .filter((call) => call.room?.roomId !== roomId)
      .forEach((call) => call.leave?.())

    if (!existingInTarget) {
      await startOrJoinVoiceGroupCall(client, roomId)
    }

    syncRoomCallInfo()
    if (roomId === activeChannelId) {
      syncActiveChannelCall()
    }
  }, [client, activeChannelId, syncRoomCallInfo, syncActiveChannelCall])

  const leaveActiveCall = useCallback(() => {
    if (client) {
      getJoinedLocalCalls(client).forEach((call) => call.leave?.())
    } else {
      activeCall?.leave?.()
    }
    syncRoomCallInfo()
    syncActiveChannelCall()
  }, [client, activeCall, syncRoomCallInfo, syncActiveChannelCall])

  const toggleMicrophone = useCallback(async () => {
    if (!activeCall?.setMicrophoneMuted) return
    const nextMuted = !isMicMuted
    try {
      await activeCall.setMicrophoneMuted(nextMuted)
      setIsMicMuted(nextMuted)
    } catch (error) {
      console.error("Failed to toggle microphone:", error)
      toast.error("Mikrofon konnte nicht umgeschaltet werden.")
    }
  }, [activeCall, isMicMuted])

  const toggleScreenshare = useCallback(async () => {
    if (!activeCall?.setScreensharingEnabled) return
    const nextScreenshare = !isScreensharing
    try {
      const enabled = await activeCall.setScreensharingEnabled(nextScreenshare)
      setIsScreensharing(nextScreenshare ? enabled : false)
    } catch (error) {
      console.error("Failed to toggle screenshare:", error)
      toast.error("Bildschirmfreigabe konnte nicht umgeschaltet werden.")
    }
  }, [activeCall, isScreensharing])

  const toggleHeadphones = useCallback(() => {
    const nextDeafened = !isDeafened
    setIsDeafened(nextDeafened)
    if (nextDeafened && activeCall?.setMicrophoneMuted && !isMicMuted) {
      void activeCall
        .setMicrophoneMuted(true)
        .then(() => setIsMicMuted(true))
        .catch((error: unknown) => console.warn("Failed to mute microphone while deafening:", error))
    }
  }, [activeCall, isDeafened, isMicMuted])

  const value = useMemo<CallContextValue>(() => {
    const selfUserId = client?.getUserId() || ""
    const activeCallRoomId = activeCall?.room?.roomId || ""
    const isInCallInActiveChannel = Boolean(
      activeCall &&
        activeCallRoomId === activeChannelId &&
        (activeCall.hasLocalParticipant?.() ?? false) &&
        activeCall.state !== "ended",
    )

    return {
      selfUserId,
      callInfoByRoom,
      activeCall,
      activeCallRoomId,
      isInCallInActiveChannel,
      callParticipants,
      callVideoFeeds,
      localUserMediaStream,
      isMicMuted,
      isScreensharing,
      isDeafened,
      joinCall,
      leaveActiveCall,
      toggleMicrophone,
      toggleScreenshare,
      toggleHeadphones,
    }
  }, [
    callInfoByRoom,
    client,
    activeCall,
    activeChannelId,
    callParticipants,
    callVideoFeeds,
    localUserMediaStream,
    isMicMuted,
    isScreensharing,
    isDeafened,
    joinCall,
    leaveActiveCall,
    toggleMicrophone,
    toggleScreenshare,
    toggleHeadphones,
  ])

  return (
    <CallContext.Provider value={value}>
      {children}
      <audio ref={remoteAudioElementRef} autoPlay hidden aria-hidden />
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


