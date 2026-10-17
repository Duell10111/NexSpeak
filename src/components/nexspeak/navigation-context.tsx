"use client"

import { createContext, useContext, type ReactNode } from "react"
import { toast } from "sonner"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { t } from "@/lib/i18n"
import { describeMatrixError } from "@/lib/matrix/errors"
import { startDirectMessage } from "@/lib/matrix/direct"
import { DIRECT_MESSAGES_ID } from "@/lib/matrix/types"

interface NavigationContextValue {
  /** Show a room; `serverId` helps while a brand-new room is not in the room list yet. */
  openRoom: (roomId: string, serverId?: string) => void
}

const NavigationContext = createContext<NavigationContextValue | undefined>(undefined)

export function NavigationProvider({
  openRoom,
  children,
}: NavigationContextValue & { children: ReactNode }) {
  return <NavigationContext.Provider value={{ openRoom }}>{children}</NavigationContext.Provider>
}

export function useNavigation(): NavigationContextValue {
  const context = useContext(NavigationContext)
  if (!context) throw new Error("useNavigation must be used within NavigationProvider")
  return context
}

/** Opens the DM with these people, creating it if needed. Resolves to whether it worked. */
export function useOpenDirectMessage(): (userIds: string[]) => Promise<boolean> {
  const { client } = useMatrixClient()
  const { openRoom } = useNavigation()

  return async (userIds) => {
    if (!client || userIds.length === 0) return false
    try {
      const roomId = await startDirectMessage(client, userIds)
      openRoom(roomId, DIRECT_MESSAGES_ID)
      return true
    } catch (error) {
      toast.error(describeMatrixError(error, t("dm.startFailed")))
      return false
    }
  }
}
