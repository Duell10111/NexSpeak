"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import {
  channelCategories,
  servers,
  currentUser,
  type Channel,
  type ChannelCategory,
} from "@/lib/nexspeak-data"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Hash,
  Volume2,
  ChevronDown,
  Settings,
  Mic,
  Headphones,
  Plus,
  Search,
} from "lucide-react"

interface ChannelSidebarProps {
  activeServerId: string
  activeChannelId: string
  onChannelSelect: (id: string) => void
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    online: "bg-nx-online",
    idle: "bg-nx-idle",
    dnd: "bg-nx-dnd",
    offline: "bg-nx-offline",
  }
  return (
    <span
      className={cn(
        "absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-[3px] border-secondary",
        colors[status] || colors.offline
      )}
    />
  )
}

function CategorySection({
  category,
  activeChannelId,
  onChannelSelect,
}: {
  category: ChannelCategory
  activeChannelId: string
  onChannelSelect: (id: string) => void
}) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="mt-4">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center px-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors group"
      >
        <ChevronDown
          className={cn(
            "mr-0.5 h-3 w-3 transition-transform",
            collapsed && "-rotate-90"
          )}
        />
        <span className="truncate">{category.name}</span>
        <Plus className="ml-auto h-4 w-4 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity" />
      </button>
      {!collapsed && (
        <div className="mt-1 flex flex-col gap-0.5">
          {category.channels.map((channel) => (
            <ChannelItem
              key={channel.id}
              channel={channel}
              isActive={activeChannelId === channel.id}
              onSelect={() => onChannelSelect(channel.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ChannelItem({
  channel,
  isActive,
  onSelect,
}: {
  channel: Channel
  isActive: boolean
  onSelect: () => void
}) {
  const Icon = channel.type === "voice" ? Volume2 : Hash

  return (
    <button
      onClick={onSelect}
      className={cn(
        "group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors",
        isActive
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-nx-hover hover:text-foreground"
      )}
    >
      <Icon className="h-4 w-4 shrink-0 opacity-70" />
      <span className="truncate">{channel.name}</span>
      {channel.unread && channel.unread > 0 && !isActive && (
        <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
          {channel.unread}
        </span>
      )}
    </button>
  )
}

export function ChannelSidebar({
  activeServerId,
  activeChannelId,
  onChannelSelect,
}: ChannelSidebarProps) {
  const server = servers.find((s) => s.id === activeServerId)
  const categories = channelCategories[activeServerId] || []

  return (
    <div className="flex h-full w-60 flex-col bg-secondary">
      {/* Server header */}
      <button className="flex h-12 items-center justify-between border-b border-border px-4 shadow-sm hover:bg-nx-hover transition-colors">
        <h2 className="truncate text-[15px] font-semibold text-foreground">
          {server?.name}
        </h2>
        <ChevronDown className="h-4 w-4 text-foreground" />
      </button>

      {/* Channels */}
      <ScrollArea className="flex-1 px-2">
        {/* Search */}
        <button className="mt-3 flex w-full items-center gap-2 rounded-md bg-input px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-nx-chat-input">
          <Search className="h-3.5 w-3.5" />
          <span>Suchen</span>
        </button>

        {categories.map((category) => (
          <CategorySection
            key={category.id}
            category={category}
            activeChannelId={activeChannelId}
            onChannelSelect={onChannelSelect}
          />
        ))}
        <div className="h-4" />
      </ScrollArea>

      {/* User panel at bottom */}
      <div className="flex items-center gap-2 border-t border-border bg-popover px-2 py-2">
        <div className="relative">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {currentUser.avatar}
          </div>
          <StatusDot status={currentUser.status} />
        </div>
        <div className="flex-1 overflow-hidden">
          <p className="truncate text-sm font-semibold text-foreground leading-tight">
            {currentUser.name}
          </p>
          <p className="truncate text-[11px] text-muted-foreground leading-tight">
            Online
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" aria-label="Mikrofon">
                <Mic className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Mikrofon</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" aria-label="Kopfhoerer">
                <Headphones className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Kopfhoerer</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" aria-label="Einstellungen">
                <Settings className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Einstellungen</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
