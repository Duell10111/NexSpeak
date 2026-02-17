export type Status = "online" | "idle" | "dnd" | "offline"

export interface User {
  id: string
  name: string
  avatar: string
  status: Status
  role?: "admin" | "moderator" | "member"
  activity?: string
}

export interface Message {
  id: string
  userId: string
  content: string
  timestamp: Date
  edited?: boolean
  reactions?: { emoji: string; count: number; reacted: boolean }[]
}

export interface Channel {
  id: string
  name: string
  type: "text" | "voice"
  unread?: number
  description?: string
}

export interface ChannelCategory {
  id: string
  name: string
  channels: Channel[]
}

export interface Server {
  id: string
  name: string
  icon: string
  color: string
  unread?: boolean
  mentions?: number
}

export const currentUser: User = {
  id: "u1",
  name: "Du",
  avatar: "D",
  status: "online",
  role: "admin",
  activity: "NexSpeak nutzen",
}

export const servers: Server[] = [
  { id: "s1", name: "NexSpeak HQ", icon: "N", color: "#10b981" },
  { id: "s2", name: "Gaming Zone", icon: "G", color: "#3b82f6", unread: true, mentions: 3 },
  { id: "s3", name: "Dev Hub", icon: "D", color: "#f59e0b" },
  { id: "s4", name: "Music Lounge", icon: "M", color: "#ef4444", unread: true },
  { id: "s5", name: "Art Studio", icon: "A", color: "#8b5cf6" },
]

export const channelCategories: Record<string, ChannelCategory[]> = {
  s1: [
    {
      id: "c1",
      name: "INFORMATION",
      channels: [
        { id: "ch1", name: "willkommen", type: "text", description: "Willkommen bei NexSpeak HQ!" },
        { id: "ch2", name: "regeln", type: "text", description: "Server-Regeln" },
        { id: "ch3", name: "ankuendigungen", type: "text", unread: 2, description: "Wichtige Ankuendigungen" },
      ],
    },
    {
      id: "c2",
      name: "ALLGEMEIN",
      channels: [
        { id: "ch4", name: "allgemein", type: "text", unread: 5, description: "Allgemeiner Chat" },
        { id: "ch5", name: "off-topic", type: "text", description: "Alles abseits des Themas" },
        { id: "ch6", name: "memes", type: "text", description: "Die besten Memes" },
      ],
    },
    {
      id: "c3",
      name: "VOICE",
      channels: [
        { id: "ch7", name: "Lounge", type: "voice" },
        { id: "ch8", name: "Gaming", type: "voice" },
        { id: "ch9", name: "Musik", type: "voice" },
      ],
    },
  ],
  s2: [
    {
      id: "c4",
      name: "GAMES",
      channels: [
        { id: "ch10", name: "minecraft", type: "text", unread: 3 },
        { id: "ch11", name: "valorant", type: "text" },
        { id: "ch12", name: "league-of-legends", type: "text" },
      ],
    },
    {
      id: "c5",
      name: "VOICE",
      channels: [
        { id: "ch13", name: "Gaming Session", type: "voice" },
      ],
    },
  ],
  s3: [
    {
      id: "c6",
      name: "DEVELOPMENT",
      channels: [
        { id: "ch14", name: "javascript", type: "text" },
        { id: "ch15", name: "react", type: "text", unread: 1 },
        { id: "ch16", name: "backend", type: "text" },
      ],
    },
  ],
  s4: [
    {
      id: "c7",
      name: "MUSIC",
      channels: [
        { id: "ch17", name: "playlists", type: "text", unread: 2 },
        { id: "ch18", name: "recommendations", type: "text" },
      ],
    },
  ],
  s5: [
    {
      id: "c8",
      name: "ART",
      channels: [
        { id: "ch19", name: "showcase", type: "text" },
        { id: "ch20", name: "feedback", type: "text" },
      ],
    },
  ],
}

export const members: Record<string, User[]> = {
  s1: [
    { id: "u1", name: "Du", avatar: "D", status: "online", role: "admin" },
    { id: "u2", name: "MaxPower", avatar: "M", status: "online", role: "moderator", activity: "Visual Studio Code" },
    { id: "u3", name: "LenaCode", avatar: "L", status: "online", role: "moderator" },
    { id: "u4", name: "TechNinja", avatar: "T", status: "idle", activity: "Spotify" },
    { id: "u5", name: "PixelArt", avatar: "P", status: "online" },
    { id: "u6", name: "ByteMe", avatar: "B", status: "dnd", activity: "Valorant" },
    { id: "u7", name: "CloudWalker", avatar: "C", status: "offline" },
    { id: "u8", name: "NeonDreams", avatar: "N", status: "offline" },
    { id: "u9", name: "StarGazer", avatar: "S", status: "idle" },
    { id: "u10", name: "DataFlow", avatar: "D", status: "online", activity: "Next.js" },
  ],
  s2: [
    { id: "u1", name: "Du", avatar: "D", status: "online", role: "admin" },
    { id: "u2", name: "MaxPower", avatar: "M", status: "online", role: "moderator" },
    { id: "u11", name: "ProGamer", avatar: "P", status: "online", activity: "Minecraft" },
    { id: "u12", name: "QuickShot", avatar: "Q", status: "dnd", activity: "Valorant" },
  ],
  s3: [
    { id: "u1", name: "Du", avatar: "D", status: "online", role: "admin" },
    { id: "u3", name: "LenaCode", avatar: "L", status: "online" },
    { id: "u10", name: "DataFlow", avatar: "D", status: "online" },
  ],
  s4: [
    { id: "u1", name: "Du", avatar: "D", status: "online" },
    { id: "u4", name: "TechNinja", avatar: "T", status: "idle" },
  ],
  s5: [
    { id: "u1", name: "Du", avatar: "D", status: "online" },
    { id: "u5", name: "PixelArt", avatar: "P", status: "online" },
  ],
}

export const messages: Record<string, Message[]> = {
  ch1: [
    { id: "m1", userId: "u2", content: "Willkommen bei NexSpeak HQ! Schaut euch die Regeln im #regeln Kanal an.", timestamp: new Date(2026, 1, 15, 10, 0) },
  ],
  ch4: [
    { id: "m2", userId: "u2", content: "Hey Leute, hat jemand das neue Update gesehen?", timestamp: new Date(2026, 1, 16, 8, 30) },
    { id: "m3", userId: "u3", content: "Ja! Die neuen Features sind echt genial.", timestamp: new Date(2026, 1, 16, 8, 32) },
    { id: "m4", userId: "u5", content: "Ich finde die neue UI besonders gut", timestamp: new Date(2026, 1, 16, 8, 35), reactions: [{ emoji: "\u{1F44D}", count: 3, reacted: true }, { emoji: "\u{1F525}", count: 1, reacted: false }] },
    { id: "m5", userId: "u4", content: "Hat jemand Lust heute Abend zu zocken?", timestamp: new Date(2026, 1, 16, 9, 0) },
    { id: "m6", userId: "u6", content: "Bin dabei! Wann genau?", timestamp: new Date(2026, 1, 16, 9, 5) },
    { id: "m7", userId: "u2", content: "So gegen 20 Uhr? Wir koennten Valorant spielen", timestamp: new Date(2026, 1, 16, 9, 10), reactions: [{ emoji: "\u{1F3AE}", count: 4, reacted: true }] },
    { id: "m8", userId: "u10", content: "Ich hab gerade ein cooles Projekt mit Next.js angefangen. Schaut mal in #dev-hub vorbei!", timestamp: new Date(2026, 1, 16, 9, 30) },
    { id: "m9", userId: "u3", content: "Nice, zeig mal her! Ich arbeite auch gerade an was Neuem.", timestamp: new Date(2026, 1, 16, 9, 35) },
    { id: "m10", userId: "u5", content: "Das Design sieht mega aus btw", timestamp: new Date(2026, 1, 16, 10, 0), reactions: [{ emoji: "\u{2764}\u{FE0F}", count: 2, reacted: false }] },
    { id: "m11", userId: "u9", content: "Guten Morgen zusammen! Was laeuft?", timestamp: new Date(2026, 1, 16, 10, 15) },
    { id: "m12", userId: "u4", content: "Moin! Alles chill hier, und bei dir?", timestamp: new Date(2026, 1, 16, 10, 18) },
    { id: "m13", userId: "u2", content: "Schaut mal diese Webseite an, richtig cool gemacht!", timestamp: new Date(2026, 1, 16, 10, 30) },
    { id: "m14", userId: "u6", content: "Der neue NexSpeak Look gefaellt mir richtig gut", timestamp: new Date(2026, 1, 16, 11, 0), reactions: [{ emoji: "\u{1F49A}", count: 5, reacted: true }, { emoji: "\u{2728}", count: 3, reacted: false }] },
  ],
  ch5: [
    { id: "m15", userId: "u4", content: "Hat jemand gute Serien-Tipps?", timestamp: new Date(2026, 1, 16, 7, 0) },
    { id: "m16", userId: "u9", content: "Severance auf Apple TV ist mega!", timestamp: new Date(2026, 1, 16, 7, 15) },
  ],
  ch10: [
    { id: "m17", userId: "u11", content: "Wer kommt auf unseren Minecraft Server?", timestamp: new Date(2026, 1, 16, 12, 0) },
    { id: "m18", userId: "u12", content: "Bin in 10 Minuten da!", timestamp: new Date(2026, 1, 16, 12, 5) },
  ],
}

export function getUserById(id: string): User | undefined {
  const allMembers = Object.values(members).flat()
  return allMembers.find((m) => m.id === id)
}

export function formatTimestamp(date: Date): string {
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  const hours = date.getHours().toString().padStart(2, "0")
  const minutes = date.getMinutes().toString().padStart(2, "0")
  if (isToday) return `Heute um ${hours}:${minutes}`
  return `${date.getDate().toString().padStart(2, "0")}.${(date.getMonth() + 1).toString().padStart(2, "0")}.${date.getFullYear()} ${hours}:${minutes}`
}
