"use client"

import { useEffect, useState, type FormEvent } from "react"
import { Check, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { MatrixAvatar } from "@/components/nexspeak/matrix-avatar"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useTranslation } from "@/hooks/useTranslation"
import { searchUsers, type UserSearchResult } from "@/lib/matrix/direct"

const SEARCH_DELAY_MS = 300

/** Directory search while the dialog is open; debounced, nothing runs while it is closed. */
function useUserSearch(term: string) {
  const { client } = useMatrixClient()
  const [state, setState] = useState<{ term: string; results: UserSearchResult[] }>({ term: "", results: [] })
  const query = term.trim()

  useEffect(() => {
    if (!client || !query) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      searchUsers(client, query, controller.signal)
        .then((results) => {
          if (!controller.signal.aborted) setState({ term: query, results })
        })
        .catch((error: unknown) => console.warn("User search failed:", error))
    }, SEARCH_DELAY_MS)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [client, query])

  const isCurrent = state.term === query
  return { results: query && isCurrent ? state.results : [], isSearching: Boolean(query) && !isCurrent }
}

function PickerForm({
  submitLabel,
  excludeUserIds,
  onSubmit,
}: {
  submitLabel: string
  excludeUserIds: string[]
  onSubmit: (users: UserSearchResult[]) => Promise<void>
}) {
  const { t } = useTranslation()
  const [term, setTerm] = useState("")
  const [selected, setSelected] = useState<UserSearchResult[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { results, isSearching } = useUserSearch(term)
  const visible = results.filter((user) => !excludeUserIds.includes(user.userId))

  const toggle = (user: UserSearchResult) => {
    setSelected((current) =>
      current.some((entry) => entry.userId === user.userId)
        ? current.filter((entry) => entry.userId !== user.userId)
        : [...current, user],
    )
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (selected.length === 0) {
      // Enter in the search field picks the first hit, like Discord's quick switcher.
      if (visible[0]) toggle(visible[0])
      return
    }
    setIsSubmitting(true)
    try {
      await onSubmit(selected)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-3">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label={t("userPicker.selected")}>
          {selected.map((user) => (
            <span key={user.userId} className="flex items-center gap-1 rounded bg-secondary py-0.5 pr-1 pl-2 text-sm">
              {user.displayName}
              <button
                type="button"
                onClick={() => toggle(user)}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                aria-label={t("userPicker.remove", { name: user.displayName })}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        autoFocus
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder={t("userPicker.placeholder")}
        aria-label={t("userPicker.search")}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        disabled={isSubmitting}
      />
      <div className="max-h-64 min-h-16 overflow-y-auto" role="listbox" aria-label={t("userPicker.results")} aria-multiselectable>
        {isSearching ? (
          <div className="flex justify-center py-4">
            <Spinner className="h-5 w-5 text-muted-foreground" />
          </div>
        ) : visible.length > 0 ? (
          visible.map((user) => {
            const isSelected = selected.some((entry) => entry.userId === user.userId)
            return (
              <button
                key={user.userId}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => toggle(user)}
                className={cn(
                  "flex w-full items-center gap-3 rounded px-2 py-1.5 text-left hover:bg-nx-hover",
                  isSelected && "bg-nx-active",
                )}
              >
                <MatrixAvatar mxcUrl={user.avatarMxc} name={user.displayName} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{user.displayName}</span>
                  <span className="block truncate text-xs text-muted-foreground">{user.userId}</span>
                </span>
                {isSelected && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            )
          })
        ) : (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            {term.trim() ? t("userPicker.noResults") : t("userPicker.hint")}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="submit" disabled={isSubmitting || selected.length === 0}>
          {isSubmitting && <Spinner className="mr-2 h-4 w-4" />}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Find people by name or Matrix ID and pick one or more of them. */
export function UserPickerDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  excludeUserIds = [],
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  submitLabel: string
  excludeUserIds?: string[]
  /** Close the dialog from here when done; errors should be reported here as well. */
  onSubmit: (users: UserSearchResult[]) => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {/* Remount per opening so every search starts empty. */}
        {open && <PickerForm submitLabel={submitLabel} excludeUserIds={excludeUserIds} onSubmit={onSubmit} />}
      </DialogContent>
    </Dialog>
  )
}
