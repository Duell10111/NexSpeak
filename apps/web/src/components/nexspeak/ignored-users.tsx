"use client"

import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { MatrixAvatar } from "@/components/nexspeak/matrix-avatar"
import { useIgnoredUsers } from "@/hooks/useIgnoredUsers"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useTranslation } from "@/hooks/useTranslation"
import { describeMatrixError } from "@nexspeak/core/matrix/errors"
import { setIgnored } from "@nexspeak/core/matrix/safety"

/** Settings → Account: everybody on the ignore list, to take them off again. */
export function IgnoredUsersList() {
  const { t } = useTranslation()
  const { client } = useMatrixClient()
  const ignored = useIgnoredUsers(client)

  const unignore = (userId: string) => {
    if (!client) return
    setIgnored(client, userId, false).catch((error: unknown) => toast.error(describeMatrixError(error, t("ignore.failed"))))
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-foreground">{t("ignore.title")}</p>
      {ignored.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("ignore.empty")}</p>
      ) : (
        <ul className="space-y-1">
          {ignored.map((userId) => {
            const user = client?.getUser(userId)
            const name = user?.displayName || userId
            return (
              <li key={userId} className="flex items-center gap-2">
                <MatrixAvatar mxcUrl={user?.avatarUrl} name={name} size={24} className="text-[10px]" />
                <span className="min-w-0 flex-1 truncate text-sm" title={userId}>
                  {name}
                </span>
                <Button size="sm" variant="outline" onClick={() => unignore(userId)}>
                  {t("ignore.unignore")}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{t("ignore.hint")}</p>
    </div>
  )
}
