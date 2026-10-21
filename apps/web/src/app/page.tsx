"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { SyncState } from "matrix-js-sdk"
import { WifiOff } from "lucide-react"
import { ServerSidebar } from "@/components/nexspeak/server-sidebar"
import { ChannelSidebar, leavableKind, type RoomSection } from "@/components/nexspeak/channel-sidebar"
import { ChatArea } from "@/components/nexspeak/chat-area"
import { MemberList } from "@/components/nexspeak/member-list"
import { CallProvider } from "@/components/nexspeak/call-context"
import { DesktopTrayVoice } from "@/components/nexspeak/desktop-tray"
import { DesktopUpdateNotice } from "@/components/nexspeak/desktop-update"
import { MatrixLinkHandler } from "@/components/nexspeak/matrix-links"
import { QuickSwitcher } from "@/components/nexspeak/quick-switcher"
import { useAttentionBadge, useMessageNotifications } from "@/hooks/useMessageNotifications"
import { SecurityProvider } from "@/components/nexspeak/security-context"
import { SecurityBanner } from "@/components/nexspeak/security-panel"
import { NavigationProvider } from "@/components/nexspeak/navigation-context"
import { FriendsProvider } from "@/components/nexspeak/friends-context"
import { FriendsView } from "@/components/nexspeak/friends-view"
import { useMatrix } from "@/components/matrix-provider"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { attentionCount, incomingFriendRequests, useRoomDirectory, type RoomDirectory } from "@/hooks/useRoomDirectory"
import { useTranslation } from "@/hooks/useTranslation"
import { describeMatrixError } from "@nexspeak/core/matrix/errors"
import { DIRECT_MESSAGES_ID, FRIENDS_VIEW_ID } from "@nexspeak/core/matrix/types"

const SELECTION_KEY = "nexspeak_selection"
// Matches Tailwind's lg breakpoint, where the member list fits next to the chat.
const WIDE_LAYOUT_QUERY = "(min-width: 1024px)"

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
  if (roomId === FRIENDS_VIEW_ID) return DIRECT_MESSAGES_ID
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
  const { t } = useTranslation()

  const [selection, setSelection] = useState<Selection>(() =>
    typeof window === "undefined" ? { serverId: "", channelId: "" } : loadSelection(),
  )
  const [lastChannelByServer, setLastChannelByServer] = useState<Record<string, string>>({})
  const [messageTarget, setMessageTarget] = useState<{ roomId: string; eventId: string; threadId?: string } | null>(null)
  const [showMembers, setShowMembers] = useState(true)
  const [isNavigationOpen, setIsNavigationOpen] = useState(false)
  const [isMemberSheetOpen, setIsMemberSheetOpen] = useState(false)

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
        { id: "direct", title: t("dm.title"), rooms: directory.directRooms },
        { id: "other", title: t("nav.rooms"), rooms: directory.otherRooms },
      ]
    : (directory.sectionsBySpace[serverId] ?? []).map((section) => ({
        id: section.id,
        title: section.name,
        isCategory: section.isCategory,
        rooms: section.rooms,
      }))
  const serverRooms = sections.flatMap((section) => section.rooms)
  const isSelectable = (id: string | undefined): id is string =>
    Boolean(id) && ((isDirectMessages && id === FRIENDS_VIEW_ID) || serverRooms.some((room) => room.id === id))
  // Home opens on the friends view, like Discord.
  const channelId = isSelectable(selection.channelId)
    ? selection.channelId
    : isSelectable(lastChannelByServer[serverId])
      ? lastChannelByServer[serverId]
      : isDirectMessages
        ? FRIENDS_VIEW_ID
        : serverRooms[0]?.id || ""
  const isFriendsView = channelId === FRIENDS_VIEW_ID

  const title = isDirectMessages
    ? t("nav.home")
    : directory.spaces.find((space) => space.id === serverId)?.name || t("nav.server")
  const homeUnread =
    directory.directRooms.reduce((sum, room) => sum + room.unread, 0) +
    directory.invites.length +
    incomingFriendRequests(directory)

  const handleServerSelect = (nextServerId: string) => {
    setMessageTarget(null)
    setSelection({ serverId: nextServerId, channelId: lastChannelByServer[nextServerId] || "" })
  }

  const handleToggleMembers = () => {
    if (window.matchMedia(WIDE_LAYOUT_QUERY).matches) {
      setShowMembers((value) => !value)
    } else {
      setIsMemberSheetOpen(true)
    }
  }

  const openRoom = (roomId: string, targetServer?: string) => {
    setMessageTarget(null)
    setIsNavigationOpen(false)
    setIsMemberSheetOpen(false)
    // Unknown yet (e.g. just joined): let the server be derived once the directory catches up.
    const server = targetServer ?? findServerFor(directory, roomId) ?? ""
    setSelection({ serverId: server, channelId: roomId })
    if (server) setLastChannelByServer((prev) => ({ ...prev, [server]: roomId }))
  }

  const handleRoomJoined = (roomId: string) => {
    setMessageTarget(null)
    setSelection({ serverId: "", channelId: roomId })
  }

  useMessageNotifications(client, channelId, openRoom)
  // Follows the (throttled) room directory, not every sync event.
  useAttentionBadge(attentionCount(directory))

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
        <h1 className="text-lg font-semibold text-foreground">{t("app.connectionFailed")}</h1>
        <p className="max-w-md text-sm text-muted-foreground">{describeMatrixError(startError)}</p>
        <div className="flex gap-2">
          <Button onClick={() => window.location.reload()}>{t("common.retry")}</Button>
          <Button variant="outline" onClick={() => void logout()}>
            {t("account.logout")}
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
          {syncState === SyncState.Error ? t("app.serverUnreachable") : t("app.syncing")}
        </p>
        {syncState === SyncState.Error && (
          <Button variant="outline" size="sm" onClick={() => void logout()}>
            {t("account.logout")}
          </Button>
        )}
      </FullscreenStatus>
    )
  }

  const isConnectionLost = syncState === SyncState.Error || syncState === SyncState.Reconnecting

  const navigation = (
    <>
      <ServerSidebar
        spaces={directory.spaces}
        roomsBySpace={directory.roomsBySpace}
        activeServerId={serverId}
        homeUnread={homeUnread}
        onServerSelect={handleServerSelect}
        onRoomJoined={handleRoomJoined}
        onServerCreated={(serverId, channelId) => openRoom(channelId, serverId)}
      />
      <ChannelSidebar
        title={title}
        sections={sections}
        invites={isDirectMessages ? directory.invites : []}
        isDirectMessages={isDirectMessages}
        serverId={isDirectMessages ? undefined : serverId}
        structureKey={directory.structureKeyBySpace[serverId]}
        activeChannelId={channelId}
        onChannelSelect={openRoom}
      />
    </>
  )

  return (
    <SecurityProvider client={client}>
      <NavigationProvider openRoom={openRoom} activeRoomId={channelId}>
        <FriendsProvider friends={directory.friends}>
          <CallProvider client={client} activeChannelId={channelId} onOpenRoom={openRoom}>
            <DesktopTrayVoice />
            <DesktopUpdateNotice />
            <MatrixLinkHandler openRoom={openRoom} selectServer={handleServerSelect} onRoomJoined={handleRoomJoined} />
            <QuickSwitcher directory={directory} activeServerId={serverId} activeRoomId={channelId} selectServer={handleServerSelect} openRoom={openRoom} />
            <div className="flex h-dvh w-screen flex-col overflow-hidden">
              <SecurityBanner />
              {isConnectionLost && (
                <div
                  className="flex shrink-0 items-center justify-center gap-2 bg-destructive px-4 py-1 text-xs font-medium text-destructive-foreground"
                  role="status"
                >
                  <WifiOff className="h-3.5 w-3.5" />
                  {t("app.connectionLost")}
                </div>
              )}
              <main className="flex min-h-0 flex-1">
                <div className="hidden md:flex">{navigation}</div>
                {isFriendsView ? (
                  <FriendsView onOpenNavigation={() => setIsNavigationOpen(true)} />
                ) : (
                  <ChatArea
                    key={channelId}
                    activeChannelId={channelId}
                    targetEventId={messageTarget?.roomId === channelId ? messageTarget.eventId : undefined}
                    targetThreadId={messageTarget?.roomId === channelId ? messageTarget.threadId : undefined}
                    onReturnToLatest={() => setMessageTarget(null)}
                    onJumpToMessage={(roomId, eventId, threadId) => {
                      openRoom(roomId)
                      setMessageTarget({ roomId, eventId, threadId })
                    }}
                    serverId={isDirectMessages || !serverId ? undefined : serverId}
                    showMembers={showMembers}
                    onToggleMembers={handleToggleMembers}
                    onOpenNavigation={() => setIsNavigationOpen(true)}
                    leavable={leavableKind(
                      sections.find((section) => section.rooms.some((room) => room.id === channelId)),
                      isDirectMessages,
                    )}
                  />
                )}
              </main>

              {/* Mobile: navigation and member list as slide-in panels, closed by tapping outside (their X would cover the headers). */}
              <Sheet open={isNavigationOpen} onOpenChange={setIsNavigationOpen}>
                <SheetContent side="left" className="w-auto max-w-none gap-0 p-0 sm:max-w-none [&>button:last-child]:hidden">
                  <SheetTitle className="sr-only">{t("nav.navigation")}</SheetTitle>
                  <SheetDescription className="sr-only">{t("nav.navigationDescription")}</SheetDescription>
                  <div className="flex h-full">{navigation}</div>
                </SheetContent>
              </Sheet>
              <Sheet open={isMemberSheetOpen} onOpenChange={setIsMemberSheetOpen}>
                <SheetContent side="right" className="w-auto gap-0 p-0 [&>button:last-child]:hidden">
                  <SheetTitle className="sr-only">{t("members.title")}</SheetTitle>
                  <SheetDescription className="sr-only">{t("members.description")}</SheetDescription>
                  {channelId && !isFriendsView && (
                    <MemberList activeRoomId={channelId} serverId={isDirectMessages || !serverId ? undefined : serverId} />
                  )}
                </SheetContent>
              </Sheet>
            </div>
          </CallProvider>
        </FriendsProvider>
      </NavigationProvider>
    </SecurityProvider>
  )
}
