"use client"

import { cn } from "@/lib/utils"
import { servers, type Server } from "@/lib/nexspeak-data"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Separator } from "@/components/ui/separator"
import { Plus, Compass } from "lucide-react"

interface ServerSidebarProps {
  activeServerId: string
  onServerSelect: (id: string) => void
}

function ServerIcon({
  server,
  isActive,
  onClick,
}: {
  server: Server
  isActive: boolean
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="relative flex items-center justify-center group">
          {/* Active / hover pill indicator */}
          <div
            className={cn(
              "absolute left-0 w-1 rounded-r-full bg-foreground transition-all duration-200",
              isActive ? "h-10" : "h-0 group-hover:h-5"
            )}
          />
          <button
            onClick={onClick}
            className={cn(
              "relative mx-3 flex h-12 w-12 items-center justify-center text-sm font-semibold transition-all duration-200",
              isActive
                ? "rounded-[16px]"
                : "rounded-[24px] hover:rounded-[16px]"
            )}
            style={{ backgroundColor: isActive ? server.color : undefined }}
            aria-label={server.name}
          >
            {!isActive && (
              <div
                className="flex h-full w-full items-center justify-center rounded-[inherit] bg-nx-guild-bar text-foreground hover:text-primary-foreground transition-colors"
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = server.color
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = ""
                }}
              >
                {server.icon}
              </div>
            )}
            {isActive && (
              <span className="text-primary-foreground">{server.icon}</span>
            )}
            {/* Mention badge */}
            {server.mentions && server.mentions > 0 && (
              <span className="absolute -bottom-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-bold text-destructive-foreground">
                {server.mentions}
              </span>
            )}
            {/* Unread dot */}
            {!server.mentions && server.unread && !isActive && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-foreground" />
            )}
          </button>
        </div>
      </TooltipTrigger>
      <TooltipContent side="right" className="font-semibold">
        {server.name}
      </TooltipContent>
    </Tooltip>
  )
}

export function ServerSidebar({ activeServerId, onServerSelect }: ServerSidebarProps) {
  return (
    <nav
      className="flex h-full w-[72px] flex-col items-center bg-nx-guild-bar py-3 overflow-y-auto"
      aria-label="Server-Liste"
    >
      {/* Home / DM button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="mx-3 mb-2 flex h-12 w-12 items-center justify-center rounded-[16px] bg-primary text-primary-foreground font-bold text-lg transition-all hover:rounded-[12px]"
            aria-label="Startseite"
          >
            <svg width="28" height="20" viewBox="0 0 28 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M5.88 0h2.68l3.22 11.02L15.1 0h2.5l3.32 11.02L24.14 0h2.68L22.2 20h-2.48L16.3 8.58 12.88 20h-2.48L5.88 0z" fill="currentColor"/>
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="font-semibold">
          Direktnachrichten
        </TooltipContent>
      </Tooltip>

      <div className="mx-auto w-8">
        <Separator className="bg-border" />
      </div>

      <div className="mt-2 flex flex-col items-center gap-2">
        {servers.map((server) => (
          <ServerIcon
            key={server.id}
            server={server}
            isActive={activeServerId === server.id}
            onClick={() => onServerSelect(server.id)}
          />
        ))}
      </div>

      <div className="mx-auto mt-2 w-8">
        <Separator className="bg-border" />
      </div>

      {/* Add Server */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button className="mx-3 mt-2 flex h-12 w-12 items-center justify-center rounded-[24px] bg-nx-guild-bar text-nx-online transition-all hover:rounded-[16px] hover:bg-nx-online hover:text-primary-foreground">
            <Plus className="h-5 w-5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="font-semibold">
          Server hinzufuegen
        </TooltipContent>
      </Tooltip>

      {/* Explore */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button className="mx-3 mt-2 flex h-12 w-12 items-center justify-center rounded-[24px] bg-nx-guild-bar text-nx-online transition-all hover:rounded-[16px] hover:bg-nx-online hover:text-primary-foreground">
            <Compass className="h-5 w-5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="font-semibold">
          Server entdecken
        </TooltipContent>
      </Tooltip>
    </nav>
  )
}
