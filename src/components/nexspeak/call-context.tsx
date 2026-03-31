"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import type { MatrixClient } from "matrix-js-sdk"
import { startOrJoinVoiceGroupCall } from "@/lib/matrix/client"

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
}

interface CallFeedLike {
  userId?: string
  stream?: MediaStream
  isLocal?: () => boolean
  getMember?: () => { name?: string } | null
}

interface GroupCallLike {
  state?: string
  room?: { roomId?: string }
  participants?: Map<unknown, Map<string, unknown>>
  userMediaFeeds?: CallFeedLike[]
  hasLocalParticipant?: () => boolean
  isMicrophoneMuted?: () => boolean
  isScreensharing?: () => boolean
  setMicrophoneMuted?: (muted: boolean) => Promise<boolean>
  setScreensharingEnabled?: (enabled: boolean) => Promise<boolean>
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
  callInfoByRoom: Record<string, RoomCallInfo>
  activeCall: GroupCallLike | null
  activeCallRoomId: string
  isInCallInActiveChannel: boolean
  callParticipants: CallParticipant[]
  callVideoFeeds: CallVideoFeed[]
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
  if (!groupCall?.userMediaFeeds) return []

  return groupCall.userMediaFeeds
    .filter((feed) => !feed.isLocal?.())
    .filter((feed): feed is CallFeedLike & { stream: MediaStream; userId: string } => Boolean(feed.stream && feed.userId))
    .map((feed, index) => ({
      id: `${feed.userId}-${index}`,
      userId: feed.userId,
      name: feed.getMember?.()?.name || feed.userId,
      stream: feed.stream,
      hasVideo: feed.stream.getVideoTracks().length > 0,
    }))
}

function toRoomCallInfo(call: GroupCallLike | null): RoomCallInfo | null {
  if (!call || call.state === "ended" || !call.participants) return null

  const names = new Set<string>()
  call.participants.forEach((_, member) => {
    if (!member || typeof member !== "object") return
    const memberObj = member as { name?: string; userId?: string }
    names.add(memberObj.name || memberObj.userId || "Unbekannt")
  })

  const normalizedNames = Array.from(names).sort((a, b) => a.localeCompare(b))
  return normalizedNames.length > 0 ? { names: normalizedNames } : null
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
  const [activeCall, setActiveCall] = useState<GroupCallLike | null>(null)
  const [callInfoByRoom, setCallInfoByRoom] = useState<Record<string, RoomCallInfo>>({})
  const [callParticipants, setCallParticipants] = useState<CallParticipant[]>([])
  const [callVideoFeeds, setCallVideoFeeds] = useState<CallVideoFeed[]>([])
  const [isMicMuted, setIsMicMuted] = useState(false)
  const [isScreensharing, setIsScreensharing] = useState(false)
  const [isDeafened, setIsDeafened] = useState(false)

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
      setCallParticipants(toCallParticipants(activeCall))
      setCallVideoFeeds(toCallVideoFeeds(activeCall))
      setIsMicMuted(activeCall.isMicrophoneMuted?.() ?? false)
      setIsScreensharing(activeCall.isScreensharing?.() ?? false)
      syncRoomCallInfo()
    }

    activeCall.on("participants_changed", refreshActive)
    activeCall.on("group_call_state_changed", refreshActive)
    activeCall.on("user_media_feeds_changed", refreshActive)
    activeCall.on("local_mute_state_changed", refreshActive)
    activeCall.on("local_screenshare_state_changed", refreshActive)
    refreshActive()

    return () => {
      activeCall.removeListener?.("participants_changed", refreshActive)
      activeCall.removeListener?.("group_call_state_changed", refreshActive)
      activeCall.removeListener?.("user_media_feeds_changed", refreshActive)
      activeCall.removeListener?.("local_mute_state_changed", refreshActive)
      activeCall.removeListener?.("local_screenshare_state_changed", refreshActive)
    }
  }, [activeCall, syncRoomCallInfo])

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
    await activeCall.setMicrophoneMuted(nextMuted)
    setIsMicMuted(nextMuted)
  }, [activeCall, isMicMuted])

  const toggleScreenshare = useCallback(async () => {
    if (!activeCall?.setScreensharingEnabled) return
    const nextScreenshare = !isScreensharing
    await activeCall.setScreensharingEnabled(nextScreenshare)
    setIsScreensharing(nextScreenshare)
  }, [activeCall, isScreensharing])

  const toggleHeadphones = useCallback(() => {
    setIsDeafened((prev) => !prev)
  }, [])

  const value = useMemo<CallContextValue>(() => {
    const activeCallRoomId = activeCall?.room?.roomId || ""
    const isInCallInActiveChannel = Boolean(
      activeCall &&
        activeCallRoomId === activeChannelId &&
        (activeCall.hasLocalParticipant?.() ?? false) &&
        activeCall.state !== "ended",
    )

    return {
      callInfoByRoom,
      activeCall,
      activeCallRoomId,
      isInCallInActiveChannel,
      callParticipants,
      callVideoFeeds,
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
    activeCall,
    activeChannelId,
    callParticipants,
    callVideoFeeds,
    isMicMuted,
    isScreensharing,
    isDeafened,
    joinCall,
    leaveActiveCall,
    toggleMicrophone,
    toggleScreenshare,
    toggleHeadphones,
  ])

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>
}

export function useCallContext(): CallContextValue {
  const context = useContext(CallContext)
  if (!context) {
    throw new Error("useCallContext must be used within CallProvider")
  }
  return context
}


