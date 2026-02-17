"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ServerSidebar } from "@/components/nexspeak/server-sidebar"
import { ChannelSidebar } from "@/components/nexspeak/channel-sidebar"
import { ChatArea } from "@/components/nexspeak/chat-area"
import { MemberList } from "@/components/nexspeak/member-list"
import { channelCategories } from "@/lib/nexspeak-data"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useRoomList } from "@/hooks/useRoomMembers"
import { loadSession } from "@/lib/matrix/storage"

export default function NexSpeakApp() {
  const router = useRouter()
  const { client } = useMatrixClient()
  const { rooms: matrixRooms } = useRoomList(client)

  const [activeServerId, setActiveServerId] = useState("s1")
  const [activeChannelId, setActiveChannelId] = useState("ch4")
  const [showMembers, setShowMembers] = useState(true)
  const [isChecking, setIsChecking] = useState(true)

  // Check if user is authenticated
  useEffect(() => {
    if (typeof window === "undefined") return

    const session = loadSession()
    if (!session) {
      router.push("/login")
    }
    setIsChecking(false)
  }, [router])

  const handleServerSelect = (serverId: string) => {
    setActiveServerId(serverId)
    if (!client) {
      // Fallback to local data
      const categories = channelCategories[serverId]
      if (categories && categories.length > 0) {
        const firstTextChannel = categories
          .flatMap((c) => c.channels)
          .find((ch) => ch.type === "text")
        if (firstTextChannel) {
          setActiveChannelId(firstTextChannel.id)
        }
      }
    } else if (matrixRooms.length > 0) {
      // Select first room
      setActiveChannelId(matrixRooms[0].id)
    }
  }

  if (isChecking) {
    return null
  }

  return (
    <main className="flex h-screen w-screen overflow-hidden">
      <ServerSidebar
        activeServerId={activeServerId}
        onServerSelect={handleServerSelect}
      />
      <ChannelSidebar
        activeServerId={activeServerId}
        activeChannelId={activeChannelId}
        onChannelSelect={setActiveChannelId}
      />
      <ChatArea
        activeServerId={activeServerId}
        activeChannelId={activeChannelId}
        showMembers={showMembers}
        onToggleMembers={() => setShowMembers(!showMembers)}
      />
      {showMembers && <MemberList activeServerId={activeServerId} />}
    </main>
  )
}
