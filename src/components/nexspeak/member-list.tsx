"use client"

import { cn } from "@/lib/utils"
import { members, type User, type Status } from "@/lib/nexspeak-data"
import { ScrollArea } from "@/components/ui/scroll-area"

interface MemberListProps {
  activeServerId: string
}

function StatusDot({ status, className }: { status: Status; className?: string }) {
  const colors: Record<Status, string> = {
    online: "bg-nx-online",
    idle: "bg-nx-idle",
    dnd: "bg-nx-dnd",
    offline: "bg-nx-offline",
  }
  return (
    <span
      className={cn(
        "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-[2.5px] border-nx-member-bg",
        colors[status],
        className
      )}
    />
  )
}

function MemberItem({ user }: { user: User }) {
  const roleColor =
    user.role === "admin"
      ? "text-primary"
      : user.role === "moderator"
      ? "text-chart-2"
      : "text-muted-foreground"

  return (
    <button className="group flex w-full items-center gap-3 rounded-md px-2 py-1.5 hover:bg-nx-hover transition-colors">
      <div className="relative">
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold",
            user.status === "offline" ? "bg-muted text-muted-foreground opacity-50" : "bg-muted text-foreground"
          )}
        >
          {user.avatar}
        </div>
        <StatusDot status={user.status} />
      </div>
      <div className="flex-1 overflow-hidden text-left">
        <p
          className={cn(
            "truncate text-sm font-medium transition-colors",
            user.status === "offline" ? "text-muted-foreground opacity-60" : roleColor,
            "group-hover:text-foreground"
          )}
        >
          {user.name}
        </p>
        {user.activity && user.status !== "offline" && (
          <p className="truncate text-[11px] text-muted-foreground leading-tight">
            {user.status === "dnd" ? "Bitte nicht storen" : user.activity}
          </p>
        )}
      </div>
    </button>
  )
}

export function MemberList({ activeServerId }: MemberListProps) {
  const serverMembers = members[activeServerId] || []

  const onlineMembers = serverMembers.filter(
    (m) => m.status === "online" || m.status === "idle" || m.status === "dnd"
  )
  const offlineMembers = serverMembers.filter((m) => m.status === "offline")

  const admins = onlineMembers.filter((m) => m.role === "admin")
  const moderators = onlineMembers.filter((m) => m.role === "moderator")
  const regularOnline = onlineMembers.filter(
    (m) => m.role !== "admin" && m.role !== "moderator"
  )

  return (
    <div className="flex h-full w-60 flex-col bg-secondary">
      <ScrollArea className="flex-1 px-2 pt-4">
        {/* Admins */}
        {admins.length > 0 && (
          <div className="mb-2">
            <h4 className="px-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              {"Admin \u2014 "}{admins.length}
            </h4>
            <div className="mt-1 flex flex-col">
              {admins.map((m) => (
                <MemberItem key={m.id} user={m} />
              ))}
            </div>
          </div>
        )}

        {/* Moderators */}
        {moderators.length > 0 && (
          <div className="mb-2">
            <h4 className="px-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              {"Moderator \u2014 "}{moderators.length}
            </h4>
            <div className="mt-1 flex flex-col">
              {moderators.map((m) => (
                <MemberItem key={m.id} user={m} />
              ))}
            </div>
          </div>
        )}

        {/* Online */}
        {regularOnline.length > 0 && (
          <div className="mb-2">
            <h4 className="px-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              {"Online \u2014 "}{regularOnline.length}
            </h4>
            <div className="mt-1 flex flex-col">
              {regularOnline.map((m) => (
                <MemberItem key={m.id} user={m} />
              ))}
            </div>
          </div>
        )}

        {/* Offline */}
        {offlineMembers.length > 0 && (
          <div className="mb-2">
            <h4 className="px-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              {"Offline \u2014 "}{offlineMembers.length}
            </h4>
            <div className="mt-1 flex flex-col">
              {offlineMembers.map((m) => (
                <MemberItem key={m.id} user={m} />
              ))}
            </div>
          </div>
        )}
        <div className="h-4" />
      </ScrollArea>
    </div>
  )
}
