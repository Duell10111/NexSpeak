"use client"

import { cn } from "@/lib/utils"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useMediaUrl } from "@/hooks/useMediaUrl"

interface MatrixAvatarProps {
  mxcUrl?: string | null
  name: string
  size?: number
  className?: string
}

export function MatrixAvatar({ mxcUrl, name, size = 32, className }: MatrixAvatarProps) {
  const { client } = useMatrixClient()
  // Request 2x for sharp avatars on high-DPI screens.
  const src = useMediaUrl(client, mxcUrl, size * 2)
  const initial = name.replace(/^[@#!]/, "").charAt(0).toUpperCase() || "?"

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold text-foreground",
        className,
      )}
      style={{ width: size, height: size }}
      // Always shown next to the name, which screen readers already read.
      aria-hidden
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- blob: URLs cannot go through next/image
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        initial
      )}
    </div>
  )
}
