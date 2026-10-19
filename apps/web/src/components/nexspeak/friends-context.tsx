"use client"

import { createContext, useContext, type ReactNode } from "react"
import { toast } from "sonner"
import type { MatrixClient } from "matrix-js-sdk"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { t } from "@nexspeak/i18n"
import { describeMatrixError } from "@nexspeak/core/matrix/errors"
import {
  acceptFriendRequest,
  blockFriend,
  declineFriendRequest,
  removeFriend,
  sendFriendRequest,
  type Friend,
} from "@nexspeak/core/matrix/friends"

/** Friends and requests from the room directory, so every view shares one computation. */
const FriendsContext = createContext<Friend[]>([])

export function FriendsProvider({ friends, children }: { friends: Friend[]; children: ReactNode }) {
  return <FriendsContext.Provider value={friends}>{children}</FriendsContext.Provider>
}

export function useFriends(): Friend[] {
  return useContext(FriendsContext)
}

export function useFriendOf(userId: string): Friend | undefined {
  return useFriends().find((friend) => friend.userId === userId)
}

export interface FriendActions {
  /** Resolves to whether all requests were sent. */
  request: (userIds: string[]) => Promise<boolean>
  accept: (friend: Friend) => Promise<void>
  decline: (friend: Friend) => Promise<void>
  /** Cancels an outgoing request or removes a friend. */
  remove: (friend: Friend) => Promise<void>
  block: (friend: Friend) => Promise<void>
}

/** The friend actions with error toasts; the lists update from sync. */
export function useFriendActions(): FriendActions {
  const { client } = useMatrixClient()

  const run = async (action: (client: MatrixClient) => Promise<unknown>): Promise<boolean> => {
    if (!client) return false
    try {
      await action(client)
      return true
    } catch (error) {
      toast.error(describeMatrixError(error, t("friends.failed")))
      return false
    }
  }

  return {
    request: async (userIds) => {
      const sent = await run((client) => Promise.all(userIds.map((userId) => sendFriendRequest(client, userId))))
      if (sent) toast.success(t("friends.requestSent"))
      return sent
    },
    accept: async (friend) => {
      await run((client) => acceptFriendRequest(client, friend))
    },
    decline: async (friend) => {
      await run((client) => declineFriendRequest(client, friend))
    },
    remove: async (friend) => {
      await run((client) => removeFriend(client, friend))
    },
    block: async (friend) => {
      await run((client) => blockFriend(client, friend))
    },
  }
}
