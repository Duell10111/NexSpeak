"use client"

import { useState } from "react"
import { ServerSidebar } from "@/components/nexspeak/server-sidebar"
import { ChannelSidebar } from "@/components/nexspeak/channel-sidebar"
import { ChatArea } from "@/components/nexspeak/chat-area"
import { MemberList } from "@/components/nexspeak/member-list"
import { channelCategories } from "@/lib/nexspeak-data"

export default function NexSpeakApp() {
  const [activeServerId, setActiveServerId] = useState("s1")
  const [activeChannelId, setActiveChannelId] = useState("ch4")
  const [showMembers, setShowMembers] = useState(true)

  const handleServerSelect = (serverId: string) => {
    setActiveServerId(serverId)
    // Select first text channel of new server
    const categories = channelCategories[serverId]
    if (categories && categories.length > 0) {
      const firstTextChannel = categories
        .flatMap((c) => c.channels)
        .find((ch) => ch.type === "text")
      if (firstTextChannel) {
        setActiveChannelId(firstTextChannel.id)
      }
    }
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
