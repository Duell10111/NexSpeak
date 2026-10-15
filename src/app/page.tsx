"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { SyncState } from "matrix-js-sdk"
import { WifiOff } from "lucide-react"
import { ServerSidebar } from "@/components/nexspeak/server-sidebar"
import { ChannelSidebar, type RoomSection } from "@/components/nexspeak/channel-sidebar"
import { ChatArea } from "@/components/nexspeak/chat-area"
import { MemberList } from "@/components/nexspeak/member-list"
import { CallProvider } from "@/components/nexspeak/call-context"
import { useMatrix } from "@/components/matrix-provider"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useRoomDirectory, type RoomDirectory } from "@/hooks/useRoomDirectory"
import { describeMatrixError } from "@/lib/matrix/errors"
import { DIRECT_MESSAGES_ID } from "@/lib/matrix/types"

const SELECTION_KEY = "nexspeak_selection"

interface Selection {
  /** Empty: derive the server from the selected channel. */
  serverId: string
  channelId: string
}

function loadSelection(): Selection {
  try {
    const parsed = JSON.parse(localStorage.getItem(SELECTION_KEY) || "null") as Partial<Selection> | null
    return { serverId: parsed?.serverId || "", channelId: parsed?.channelId || "" }
  } catch {
    return { serverId: "", channelId: "" }
  }
}

function findServerFor(directory: RoomDirectory, roomId: string): string | null {
  if (!roomId) return null
  if (directory.spaces.some((space) => space.id === roomId)) return roomId
  const space = directory.spaces.find((candidate) =>
    directory.roomsBySpace[candidate.id]?.some((room) => room.id === roomId),
  )
  if (space) return space.id
  const inHome = [...directory.directRooms, ...directory.otherRooms].some((room) => room.id === roomId)
  return inHome ? DIRECT_MESSAGES_ID : null
}

function FullscreenStatus({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex h-dvh w-screen flex-col items-center justify-center gap-4 bg-background p-4 text-center">
      {children}
    </main>
  )
}

export default function NexSpeakApp() {
  const router = useRouter()
  const { session, client, syncState, startError, logout } = useMatrix()
  const directory = useRoomDirectory(client)

  const [selection, setSelection] = useState<Selection>(() =>
    typeof window === "undefined" ? { serverId: "", channelId: "" } : loadSelection(),
  )
  const [lastChannelByServer, setLastChannelByServer] = useState<Record<string, string>>({})
  const [showMembers, setShowMembers] = useState(true)

  useEffect(() => {
    if (session === null) router.replace("/login")
  }, [router, session])

  useEffect(() => {
    try {
      localStorage.setItem(SELECTION_KEY, JSON.stringify(selection))
    } catch {
      // Persisting the last view is a convenience only.
    }
  }, [selection])

  // Resolve the selection against the current room directory.
  const isKnownServer =
    selection.serverId === DIRECT_MESSAGES_ID || directory.spaces.some((space) => space.id === selection.serverId)
  const serverId =
    (isKnownServer ? selection.serverId : findServerFor(directory, selection.channelId)) ||
    directory.spaces[0]?.id ||
    DIRECT_MESSAGES_ID
  const isDirectMessages = serverId === DIRECT_MESSAGES_ID

  const sections: RoomSection[] = isDirectMessages
    ? [
        { id: "direct", title: "Direktnachrichten", rooms: directory.directRooms },
        { id: "other", title: "Räume", rooms: directory.otherRooms },
      ]
    : [{ id: serverId, rooms: directory.roomsBySpace[serverId] ?? [] }]
  const serverRooms = sections.flatMap((section) => section.rooms)
  const channelId = serverRooms.some((room) => room.id === selection.channelId)
    ? selection.channelId
    : lastChannelByServer[serverId] && serverRooms.some((room) => room.id === lastChannelByServer[serverId])
      ? lastChannelByServer[serverId]
      : serverRooms[0]?.id || ""

  const title = isDirectMessages
    ? "Startseite"
    : directory.spaces.find((space) => space.id === serverId)?.name || "Server"
  const homeUnread =
    directory.directRooms.reduce((sum, room) => sum + room.unread, 0) + directory.invites.length

  const handleServerSelect = (nextServerId: string) => {
    setSelection({ serverId: nextServerId, channelId: lastChannelByServer[nextServerId] || "" })
  }

  const handleChannelSelect = (roomId: string) => {
    const targetServer = findServerFor(directory, roomId)
    // Unknown yet (e.g. just joined): let the server be derived once the directory catches up.
    setSelection({ serverId: targetServer ?? "", channelId: roomId })
    if (targetServer) setLastChannelByServer((prev) => ({ ...prev, [targetServer]: roomId }))
  }

  const handleRoomJoined = (roomId: string) => {
    setSelection({ serverId: "", channelId: roomId })
  }

  if (session === undefined || session === null) {
    return (
      <FullscreenStatus>
        <Spinner className="h-6 w-6 text-muted-foreground" />
      </FullscreenStatus>
    )
  }

  if (startError) {
    return (
      <FullscreenStatus>
        <h1 className="text-lg font-semibold text-foreground">Verbindung fehlgeschlagen</h1>
        <p className="max-w-md text-sm text-muted-foreground">{describeMatrixError(startError)}</p>
        <div className="flex gap-2">
          <Button onClick={() => window.location.reload()}>Erneut versuchen</Button>
          <Button variant="outline" onClick={() => void logout()}>
            Abmelden
          </Button>
        </div>
      </FullscreenStatus>
    )
  }

  const isInitialSyncComplete = Boolean(client?.isInitialSyncComplete())
  if (!client || !isInitialSyncComplete) {
    return (
      <FullscreenStatus>
        <Spinner className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {syncState === SyncState.Error ? "Server nicht erreichbar, neuer Versuch läuft…" : "Synchronisiere mit deinem Homeserver…"}
        </p>
        {syncState === SyncState.Error && (
          <Button variant="outline" size="sm" onClick={() => void logout()}>
            Abmelden
          </Button>
        )}
      </FullscreenStatus>
    )
  }

  const isConnectionLost = syncState === SyncState.Error || syncState === SyncState.Reconnecting

  return (
    <CallProvider client={client} activeChannelId={channelId}>
      <div className="flex h-dvh w-screen flex-col overflow-hidden">
        {isConnectionLost && (
          <div
            className="flex shrink-0 items-center justify-center gap-2 bg-destructive px-4 py-1 text-xs font-medium text-destructive-foreground"
            role="status"
          >
            <WifiOff className="h-3.5 w-3.5" />
            Verbindung zum Server unterbrochen – neuer Versuch läuft…
          </div>
        )}
        <main className="flex min-h-0 flex-1">
          <ServerSidebar
            spaces={directory.spaces}
            activeServerId={serverId}
            homeUnread={homeUnread}
            onServerSelect={handleServerSelect}
            onRoomJoined={handleRoomJoined}
          />
          <ChannelSidebar
            title={title}
            sections={sections}
            invites={isDirectMessages ? directory.invites : []}
            isDirectMessages={isDirectMessages}
            activeChannelId={channelId}
            onChannelSelect={handleChannelSelect}
          />
          <ChatArea
            key={channelId}
            activeChannelId={channelId}
            showMembers={showMembers}
            onToggleMembers={() => setShowMembers((value) => !value)}
          />
          {showMembers && channelId && <MemberList activeRoomId={channelId} />}
        </main>
      </div>
    </CallProvider>
  )
}
