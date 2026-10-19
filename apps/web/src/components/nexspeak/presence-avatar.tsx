"use client"

import { cn } from "@/lib/utils"
import { useTranslation } from "@/hooks/useTranslation"
import { MatrixAvatar } from "@/components/nexspeak/matrix-avatar"
import type { UserPresence } from "@nexspeak/core/matrix/presence"
import type { MessageKey } from "@nexspeak/i18n"

export const USER_PRESENCE_COLORS: Record<UserPresence, string> = {
  online: "bg-nx-online",
  unavailable: "bg-nx-idle",
  offline: "bg-nx-offline",
  unknown: "bg-nx-offline",
}

export const USER_PRESENCE_LABELS: Record<UserPresence, MessageKey | null> = {
  online: "presence.online",
  unavailable: "presence.away",
  offline: "presence.offline",
  unknown: null,
}

/** An avatar with Discord's presence dot; no dot while the server sends no presence. */
export function PresenceAvatar({
  mxcUrl,
  name,
  presence = "unknown",
  size = 32,
  className,
  dotClassName = "border-secondary",
}: {
  mxcUrl?: string
  name: string
  presence?: UserPresence
  size?: number
  className?: string
  /** The dot's border matches the background behind the avatar. */
  dotClassName?: string
}) {
  const { t } = useTranslation()
  const label = USER_PRESENCE_LABELS[presence]

  return (
    <div className={cn("relative shrink-0", className)}>
      <MatrixAvatar mxcUrl={mxcUrl} name={name} size={size} />
      {presence !== "unknown" && (
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 h-3.5 w-3.5 rounded-full border-[3px]",
            USER_PRESENCE_COLORS[presence],
            dotClassName,
          )}
          role="img"
          aria-label={label ? t(label) : undefined}
        />
      )}
    </div>
  )
}
