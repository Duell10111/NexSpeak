/**
 * MATRIX INTEGRATION GUIDE (v1)
 * 
 * Übersicht über die Matrix-Integration für NexSpeak
 */

# Matrix Integration für NexSpeak - v1

## 📋 Architektur-Übersicht

### Komponenten

```
src/
├── lib/matrix/
│   ├── client.ts          # Matrix SDK Wrapper, Singleton Pattern
│   ├── storage.ts         # Session Persistence (localStorage)
│   ├── types.ts           # TypeScript Interfaces + Converter
│
├── hooks/
│   ├── useMatrixClient.ts     # Client Lifecycle Management
│   ├── useRoomTimeline.ts     # Message Timeline + Pagination
│   ├── useRoomMembers.ts      # Room List + Unread Counts
│
├── components/
│   ├── matrix-provider.tsx    # Auth Context + Login State
│   ├── nexspeak/
│   │   └── chat-area.tsx      # Matrix Integration (Messages + Send)
│
├── app/
│   ├── login/page.tsx         # Matrix Login Form
│   └── page.tsx               # Main App + Session Check
```

## 🔑 Wichtige Konzepte

### 1. Session Management
```typescript
// Session wird in localStorage gespeichert
interface MatrixSession {
  homeserverUrl: string      // z.B. https://matrix.org
  userId: string             // @user:matrix.org
  accessToken: string        // Authentifizierung
  deviceId: string           // Device Identifier
}
```

- **Speicherung**: `localStorage` (nur Browser)
- **Tokens**: Nie in URLs, nie in Server Logs
- **Lebensdauer**: Persistiert über Page Reloads
- **Logout**: `clearSession()` löscht lokal, `client.logout()` benachrichtigt Server

### 2. Client Lifecycle

```
App Start
  ↓
loadSession() → Laden aus localStorage
  ↓
useMatrixClient() → Client initialisieren
  ↓
client.startClient() → Sync beginnen
  ↓
subscribeSyncStatus() → Events: PREPARING → SYNCED
  ↓
useRoomList() + useRoomTimeline() → Daten streamen
  ↓
logout() → Client stoppen, Session löschen
```

### 3. Message Deduplication

Messages werden mit ihrer Event-ID keyed:
```typescript
// messageMapRef.current: Map<eventId, MatrixMessage>
// Neue Events: prüfe ob bereits in Map, sonst add + setMessages()
```

## 🚀 Workflow

### Login
```typescript
const { login, isLoading, error } = useMatrixAuth()

// User gibt ein: homeserver, username, password
await login('https://matrix.org', '@user', 'pass')
// → Session gespeichert
// → Client initialisiert
// → Redirect zu /
```

### Rooms & Messages Laden

```typescript
// In Main Page
const { client } = useMatrixClient()              // Client + Sync
const { rooms } = useRoomList(client)             // Room List
const { messages } = useRoomTimeline(client, roomId) // Messages
```

### Nachrichten Senden

```typescript
// In ChatArea
await client.sendTextMessage(roomId, content)
// → Message erscheint via Timeline Event
// → Deduplication verhindert Duplikate
```

## 🔧 Konfiguration

### Homeserver URL
Standardmäßig: `https://matrix.org`

Unterstützte Homeserver:
- `https://matrix.org` (öffentlich)
- Selbst gehostete Server
- `https://matrix.example.com`

**CORS-Hinweis**: Manche Server erfordern CORS-Konfiguration:
```yaml
# homeserver.yaml
http_proxy: false
http_bind_addresses: ['::1', '127.0.0.1']

client_wellknown:
  m.homeserver:
    base_url: "https://matrix.org"
```

### Initial Sync Limit

```typescript
// In src/lib/matrix/client.ts
initialSyncLimit: 10  // Nur letzte 10 Events pro Room laden
```

**Tuning**:
- `initialSyncLimit: 5` → Schneller, weniger History
- `initialSyncLimit: 30` → Vollständiger, langsamer
- `lazyLoadMembers: true` → Member nicht automatisch laden (Speicher)

## 📍 Integration Points

### 1. Channel Sidebar
**Datei**: `src/components/nexspeak/channel-sidebar.tsx`

Zeigt aktuell statische Channels. Für Matrix:
```typescript
// TODO: useRoomList() verwenden um Matrix Rooms anzuzeigen
// TODO: unread counts aus room.getUnreadNotificationCount()
```

### 2. Member List
**Datei**: `src/components/nexspeak/member-list.tsx`

Zeigt statische Member. Für Matrix:
```typescript
// TODO: Hook für room.getMembers()
// TODO: Presence Updates (online/idle/offline)
```

### 3. Chat Area
**Status**: ✅ Integriert

- Messages aus Matrix oder Local Data
- `useRoomTimeline()` für Live Updates
- `client.sendTextMessage()` für Senden
- Deduplication built-in

## ⚠️ Bekannte Limitations (v1)

- ❌ **E2EE**: Nicht unterstützt (nur unverschlüsselte Rooms)
- ❌ **Typing Indicator**: Nicht implementiert
- ❌ **Read Receipts**: Nicht implementiert
- ❌ **Rich Media**: Nur Text-Messages
- ❌ **Voice/Video**: Nicht implementiert
- ❌ **Reactions**: Nicht implementiert (nur angezeigt)
- ⚠️ **Device Management**: Minimalist (kein Multi-Device)

## 🔍 Debugging

### Console Logs

Alle wichtigen Operationen loggen zu `console`:

```typescript
// lib/matrix/client.ts
console.error('Failed to start Matrix client:', err)

// hooks/useMatrixClient.ts
console.error('Failed to start Matrix client:', err)

// hooks/useRoomTimeline.ts
console.error('Failed to load more messages:', error)
```

### Browser DevTools

**Application → Local Storage**:
```json
{
  "nexspeak_matrix_session": {
    "homeserverUrl": "https://matrix.org",
    "userId": "@user:matrix.org",
    "accessToken": "syt_...",
    "deviceId": "GHTYAJBDE"
  }
}
```

**Console → Errors/Logs**:
```javascript
// Test Session laden
localStorage.getItem('nexspeak_matrix_session')

// Test Client
// (Browser nur - wird in SSR Error werfen)
```

## 🏗️ Architektur-Entscheidungen

### Warum Singleton Pattern?
```typescript
// lib/matrix/client.ts: let matrixClientInstance = null
// → Nur 1 Client pro Browser
// → Vermeidet Event Listener Duplikate
// → Speicher-effizient
```

### Warum localStorage statt IndexedDB?
```typescript
// v1: localStorage ausreichend (nur 4 Felder)
// v2: IndexedDB falls Offline Support nötig
```

### Warum "use client" überall?
```typescript
// matrix-js-sdk braucht browser APIs:
// - localStorage
// - fetch / XMLHttpRequest
// - EventEmitter
// → Kann nicht in Server Components laufen
```

### Warum separate types.ts?
```typescript
// Konvertiert Matrix SDK Types zu App Types
// → Clean Separation
// → Falls Matrix SDK wechselt, nur 1 Datei updaten
```

## 🔮 Nächste Schritte (v2+)

1. **Typing Indicator**
   ```typescript
   client.sendTypingNotification(roomId, true)
   ```

2. **Read Receipts**
   ```typescript
   client.sendReadReceipt(eventId)
   ```

3. **Rich Media**
   - Images: `m.image`
   - Files: `m.file`
   - Video: `m.video`

4. **E2EE Support**
   - Require `crypto-js` oder `@matrix-org/olm`
   - Key Management UI

5. **Offline Support**
   - IndexedDB State Persistence
   - Queue lokale Messages bis online

6. **Voice Chat** (später)
   - VOIP Integration
   - WebRTC

## 📚 Ressourcen

- **Matrix Spec**: https://spec.matrix.org
- **matrix-js-sdk Docs**: https://matrix-org.github.io/matrix-js-sdk/
- **Element (Ref Client)**: https://element.io

