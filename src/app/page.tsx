"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ServerSidebar } from "@/components/nexspeak/server-sidebar"
import { ChannelSidebar } from "@/components/nexspeak/channel-sidebar"
import { ChatArea } from "@/components/nexspeak/chat-area"
import { MemberList } from "@/components/nexspeak/member-list"
import { CallProvider } from "@/components/nexspeak/call-context"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useDirectRoomList, useRoomList, useSpaceList } from "@/hooks/useRoomMembers"
import { loadSession } from "@/lib/matrix/storage"
import { DIRECT_MESSAGES_ID } from "@/lib/matrix/types"

export default function NexSpeakApp() {
  const router = useRouter()
  const { client } = useMatrixClient()
  const { rooms: matrixRooms } = useRoomList(client)
  const { rooms: directRooms } = useDirectRoomList(client)
  const { spaces, roomsBySpace } = useSpaceList(client)
  const directRoomIds = new Set(directRooms.map((room) => room.id))
  const nonDirectRooms = matrixRooms.filter((room) => !directRoomIds.has(room.id))

  const [activeServerId, setActiveServerId] = useState("")
  const [activeChannelId, setActiveChannelId] = useState("")
  const [showMembers, setShowMembers] = useState(true)
  const session = typeof window !== "undefined" ? loadSession() : null

  // Check if user is authenticated
  useEffect(() => {
    if (!session) {
      router.push("/login")
    }
  }, [router, session])

  const handleServerSelect = (serverId: string) => {
    setActiveServerId(serverId)

    if (serverId === DIRECT_MESSAGES_ID) {
      setActiveChannelId(directRooms[0]?.id || "")
      return
    }

    const firstSpaceRoom = roomsBySpace[serverId]?.[0]

    if (firstSpaceRoom) {
      setActiveChannelId(firstSpaceRoom.id)
    } else if (nonDirectRooms.length > 0) {
      setActiveChannelId(nonDirectRooms[0].id)
    } else {
      setActiveChannelId("")
    }
  }

  const effectiveServerId = activeServerId || spaces[0]?.id || ""
  const effectiveServerRooms =
    effectiveServerId === DIRECT_MESSAGES_ID
      ? directRooms
      : effectiveServerId
        ? roomsBySpace[effectiveServerId] || []
        : []
  const isActiveChannelInServer = effectiveServerRooms.some((room) => room.id === activeChannelId)
  const fallbackChannelId =
    effectiveServerId === DIRECT_MESSAGES_ID
      ? directRooms[0]?.id
      : nonDirectRooms[0]?.id
  const effectiveChannelId =
    (isActiveChannelInServer ? activeChannelId : "") ||
    effectiveServerRooms[0]?.id ||
    fallbackChannelId ||
    ""

  if (!session) {
    return null
  }

  return (
    <CallProvider client={client} activeChannelId={effectiveChannelId}>
      <main className="flex h-screen w-screen overflow-hidden">
        <ServerSidebar
          activeServerId={effectiveServerId}
          onServerSelect={handleServerSelect}
        />
        <ChannelSidebar
          activeServerId={effectiveServerId}
          activeChannelId={effectiveChannelId}
          onChannelSelect={setActiveChannelId}
        />
        <ChatArea
          activeServerId={effectiveServerId}
          activeChannelId={effectiveChannelId}
          showMembers={showMembers}
          onToggleMembers={() => setShowMembers(!showMembers)}
        />
        {showMembers && <MemberList activeRoomId={effectiveChannelId} />}
      </main>
    </CallProvider>
  )
}
