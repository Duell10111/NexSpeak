"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ServerSidebar } from "@/components/nexspeak/server-sidebar"
import { ChannelSidebar } from "@/components/nexspeak/channel-sidebar"
import { ChatArea } from "@/components/nexspeak/chat-area"
import { MemberList } from "@/components/nexspeak/member-list"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useRoomList, useSpaceList } from "@/hooks/useRoomMembers"
import { loadSession } from "@/lib/matrix/storage"

export default function NexSpeakApp() {
  const router = useRouter()
  const { client } = useMatrixClient()
  const { rooms: matrixRooms } = useRoomList(client)
  const { spaces, roomsBySpace } = useSpaceList(client)

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
    const firstSpaceRoom = roomsBySpace[serverId]?.[0]

    if (firstSpaceRoom) {
      setActiveChannelId(firstSpaceRoom.id)
    } else if (matrixRooms.length > 0) {
      setActiveChannelId(matrixRooms[0].id)
    }
  }

  const effectiveServerId = activeServerId || spaces[0]?.id || ""
  const effectiveServerRooms = effectiveServerId ? roomsBySpace[effectiveServerId] || [] : []
  const effectiveChannelId = activeChannelId || effectiveServerRooms[0]?.id || matrixRooms[0]?.id || ""

  if (!session) {
    return null
  }

  return (
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
  )
}
