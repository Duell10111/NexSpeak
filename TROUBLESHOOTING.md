/**
 * TROUBLESHOOTING GUIDE - Matrix Integration für NexSpeak
 */

# Troubleshooting Guide - Matrix Integration

## 🔴 Häufige Fehler & Lösungen

---

## 1️⃣ CORS Fehler

### ❌ Error
```
Access to XMLHttpRequest at 'https://matrix.org/_matrix/...' from origin 
'http://localhost:3000' has been blocked by CORS policy
```

### 🔍 Ursache
Matrix Homeserver hat Cross-Origin Requests nicht konfiguriert.

### ✅ Lösung

**Option A: Homeserver CORS aktivieren**

```yaml
# homeserver.yaml (z.B. Synapse)
http_bind_addresses:
  - '127.0.0.1'
  - '::'

listeners:
  - port: 8008
    tls: false
    type: http
    x_forwarded: true
    resources:
      - names: [client, federation]
        compress: false
```

**Option B: CORS Proxy verwenden (Dev)**

```typescript
// src/lib/matrix/client.ts
const baseUrl = process.env.NEXT_PUBLIC_MATRIX_HOMESERVER 
              || 'https://cors-anywhere.herokuapp.com/https://matrix.org'
```

**Option C: Reverse Proxy (Production)**

```nginx
# nginx.conf
server {
    listen 443 ssl;
    server_name matrix.example.com;
    
    location /_matrix {
        proxy_pass http://homeserver:8008;
        proxy_set_header Host $host;
        add_header 'Access-Control-Allow-Origin' '*' always;
    }
}
```

**Option D: Andere Homeserver mit CORS**

```typescript
// Versuche andere öffentliche Server
- https://matrix.org (CORS oft limitiert)
- https://tchncs.de (deutscher Server)
- https://kde.org (öffentlich)
```

---

## 2️⃣ Login fehlgeschlagen

### ❌ Error
```
Error: Invalid login response: missing required fields
```

### 🔍 Ursache
- Falsche Homeserver URL
- Benutzer existiert nicht
- Passwort falsch
- Homeserver antwortet nicht

### ✅ Debugging

```typescript
// src/app/login/page.tsx - Konsole testen

// 1. Homeserver erreichbar?
await fetch('https://matrix.org/_matrix/client/versions')
  .then(r => r.json())
  .then(d => console.log('OK:', d))

// 2. Benutzername Format prüfen
// Erlaubt: 'user', '@user:matrix.org', '@user' (automatisch ergänzt)

// 3. Test mit curl
curl -X POST https://matrix.org/_matrix/client/r0/login \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "m.login.password",
    "user": "your_user",
    "password": "your_pass",
    "initial_device_display_name": "NexSpeak"
  }'
```

### ✅ Lösungen

**Überprüfe Login-Daten:**
```
Username: user (ohne @ und :matrix.org)
Password: Dein Passwort
Homeserver: https://matrix.org (mit https://)
```

**Matrix Account erstellen:**
- https://app.element.io → "Create account"
- Oder: https://matrix.org/try-matrix/clients/

**Fallback Homeserver testen:**
```typescript
// Statt matrix.org versuchen:
const servers = [
  'https://matrix.org',
  'https://kde.org',
  'https://tchncs.de',
]
```

---

## 3️⃣ Sync hängt / Initial Sync Limit

### ❌ Error
```
App bleibt loading
useMatrixClient() → isReady: false
```

### 🔍 Ursache
- Zu viele Rooms/Messages
- Zu viele Memberships
- Langsame Netzwerk-Verbindung
- Homeserver überlastet

### ✅ Tuning

**Reduziere Initial Sync Limit:**

```typescript
// src/lib/matrix/client.ts
const matrixClient = createClient({
  // ...
  initialSyncLimit: 5,          // ← Reduzieren (Standard: 10)
  lazyLoadMembers: true,        // ← Bereits enabled
  experimentalOlmEncryption: {
    enabled: false              // ← Disable E2EE (Overhead)
  }
})
```

**Pagination tunen:**

```typescript
// src/hooks/useRoomTimeline.ts
const BACKFILL_LIMIT = 20  // ← Reduzieren (Standard: 30)
```

**Größe Monitor:**

```typescript
// Browser DevTools → Performance Monitor
// Achte auf:
// - Memory Usage
// - Event Listeners Count
// - Network Requests/sec
```

---

## 4️⃣ Duplicate Messages

### ❌ Problem
```
Nachricht erscheint 2-3x in der Liste
```

### 🔍 Ursache
- Event Listener mehrfach registriert
- Deduplication nicht funktioniert
- Room wechsel mit Lag

### ✅ Überprüfung

**Prüfe Event Listener:**

```typescript
// Browser Console
const client = window.__debugMatrixClient  // Falls exportiert
const listeners = client.listenerCount('Room.timeline')
console.log('Listeners:', listeners)  // Sollte 1 sein
```

**Prüfe Message IDs:**

```typescript
// Schreibe Nachrichten mit unique IDs
// In src/hooks/useRoomTimeline.ts:

if (!messageMapRef.current.has(msg.id)) {
  messageMapRef.current.set(msg.id, msg)
  // Nur dann setState
}
```

**Cleanup on Room Change:**

```typescript
// In useRoomTimeline.ts - wird bereits gemacht
useEffect(() => {
  messageMapRef.current.clear()    // ← Clear beim Room-Wechsel
  if (unsubscribeRef.current) {
    unsubscribeRef.current()       // ← Cleanup alte Listener
  }
  // ... neue subscription
}, [client, roomId])
```

---

## 5️⃣ Hydration / SSR Import Fehler

### ❌ Error
```
ReferenceError: localStorage is not defined
- oder -
Cannot read property 'window' of undefined
```

### 🔍 Ursache
Matrix SDK wird in Server Component oder SSR Phase aufgerufen.

### ✅ Lösung

**`use client` überprüfen:**

```typescript
// ✅ RICHTIG
'use client'

import { useMatrixClient } from '@/hooks/useMatrixClient'

export function ChatArea() {
  const { client } = useMatrixClient()  // OK - Browser only
}

// ❌ FALSCH
// Keine 'use client'
import { createClient } from 'matrix-js-sdk'

export function Layout() {
  const client = createClient({})  // ERROR - SSR!
}
```

**Guards verwenden:**

```typescript
// src/lib/matrix/storage.ts
export function loadSession(): MatrixSession | null {
  // ✅ Guard gegen SSR
  if (typeof window === 'undefined') {
    return null
  }
  
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    return data ? JSON.parse(data) : null
  } catch (error) {
    return null
  }
}
```

**Dynamische Imports:**

```typescript
// Falls nötig: Server Component nur Client laden
import dynamic from 'next/dynamic'

const ChatArea = dynamic(
  () => import('@/components/nexspeak/chat-area'),
  { ssr: false }
)
```

---

## 6️⃣ Multiple Listeners / Memory Leak

### ❌ Problem
```
Browser RAM wächst kontinuierlich
DevTools → Performance → Memory
```

### 🔍 Ursache
Listener werden nicht aufgeräumt bei:
- Room wechsel
- Page navigation
- Component unmount

### ✅ Überprüfung & Fix

**Prüfe Listener:**

```typescript
// Browser Console
console.log(client.listenerCount('Room.timeline'))
console.log(client.listenerCount('sync'))
// Sollte nicht ständig anwachsen
```

**Fix in Hooks:**

```typescript
// src/hooks/useRoomTimeline.ts
useEffect(() => {
  // ... setup listeners
  
  return () => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current()  // ← WICHTIG!
    }
  }
}, [client, roomId])  // ← Dependency auf roomId!
```

**Global Check:**

```typescript
// App startup
export function useMatrixClient() {
  useEffect(() => {
    return () => {
      // DON'T dispose client here
      // Client persists across navigations
      // Only dispose on explicit logout
    }
  }, [])
}
```

---

## 7️⃣ Session Lost / Infinite Redirect Loop

### ❌ Problem
```
Login → Page → Redirect zu /login → Refresh → Redirect /login
```

### 🔍 Ursache
- Session wird nach Login nicht gespeichert
- Session wird nach Refresh nicht wiederhergestellt
- Router redirect Loop

### ✅ Fix

**Überprüfe Session Storage:**

```typescript
// Browser Console
localStorage.getItem('nexspeak_matrix_session')
// Sollte JSON Object sein, nicht null
```

**Überprüfe Redirect Logic:**

```typescript
// src/app/page.tsx
useEffect(() => {
  const session = loadSession()
  if (!session) {
    router.push('/login')  // ← Redirect nur wenn kein Session!
  }
}, [router])
// ✅ Dependency Array hat [router]
```

**Überprüfe Login Success:**

```typescript
// src/app/login/page.tsx
const handleSubmit = async (e: React.FormEvent) => {
  try {
    await login(...)  // ← Macht saveSession()
    router.push('/')  // ← Redirect nach Success
  } catch (err) {
    // Error Handler
  }
}
```

---

## 8️⃣ Messages Laden Nicht (leere Timeline)

### ❌ Problem
```
Raum ausgewählt, aber keine Messages sichtbar
useRoomTimeline() → messages: []
```

### 🔍 Ursache
- Room hat keine Messages
- Timeline nicht initialisiert
- Event Konvertierung fehlgeschlagen
- Filterung entfernt alle Events

### ✅ Debugging

**Überprüfe Room:**

```typescript
// Browser Console
const client = window.__debugClient  // Falls exported
const room = client.getRoom(roomId)
console.log('Room:', room)
console.log('Events:', room.getLiveTimeline().getEvents())
console.log('Event count:', room.getLiveTimeline().getEvents().length)
```

**Überprüfe Event Types:**

```typescript
// In src/lib/matrix/types.ts
export function eventToMatrixMessage(event, roomId) {
  const type = event.getType()
  console.log('Event type:', type)  // ← Sollte 'm.room.message' sein
  
  if (type !== 'm.room.message') return null
  
  const content = event.getContent()
  console.log('msgtype:', content.msgtype)  // ← Sollte 'm.text' sein
}
```

**Überprüfe Deduplication:**

```typescript
// In src/hooks/useRoomTimeline.ts
const msg = eventToMatrixMessage(event, roomId)
if (!msg) {
  console.log('Event filtered out')  // ← Siehst du das?
  return
}

if (!messageMapRef.current.has(msg.id)) {
  messageMapRef.current.set(msg.id, msg)
  console.log('Message added:', msg.id)
}
```

---

## 9️⃣ Access Token Expired

### ❌ Error
```
401 Unauthorized
Access token expired
```

### 🔍 Ursache
Matrix Session ist älter als Token Lifetime (meist 24h)

### ✅ Lösung

**Aktueller Workflow (v1):**
- Token wird in localStorage gespeichert
- Nach Expiry: Neue Login erforderlich
- Kein automatisches Refresh

**Für v2: Refresh Token Support**

```typescript
// Zukünftig in useMatrixClient.ts
const handleUnauthorized = async (error) => {
  if (error.status === 401) {
    // Versuche mit Refresh Token neu zu authentifizieren
    const newToken = await refreshAccessToken()
    saveSession({ ...session, accessToken: newToken })
  }
}
```

**Workaround v1:**

```typescript
// In useMatrixClient.ts - Error Handling
client.on('sync' as any, (status) => {
  if (status === 'ERROR') {
    // Versuche zu logout und zu login
    console.error('Sync error - token may be expired')
    // Optional: auto-redirect zu /login
  }
})
```

---

## 🔟 Performance: Zu viele Rooms

### ❌ Problem
```
App wird langsam mit 100+ Rooms
Memory usage hoch
```

### 🔍 Ursache
- `useRoomList()` lädt alle Rooms
- Große Timelines pro Room
- Zu viele Event Listener

### ✅ Optimierung

**Pagination für Rooms:**

```typescript
// TODO: In useRoomMembers.ts implementieren
const PAGE_SIZE = 20

export function useRoomList(client, { limit = PAGE_SIZE } = {}) {
  const [rooms, setRooms] = useState<MatrixRoom[]>([])
  const [hasMore, setHasMore] = useState(true)
  
  // Nur erste N Rooms laden
  // loadMore() für Rest
}
```

**Backfill Limit erhöhen:**

```typescript
// src/hooks/useRoomTimeline.ts
const BACKFILL_LIMIT = 10  // ← Reduzieren statt 30
```

**Lazy Load Room Timelines:**

```typescript
// Nur Timeline für aktiven Room laden
// Bei Room-Wechsel: unsubscribe alt, subscribe neu
```

---

## 🎯 Performance Monitoring Checklist

```typescript
// Browser DevTools optimieren

// 1. Memory Check
console.memory?.usedJSHeapSize  // Sollte konstant bleiben

// 2. Listener Count
console.log(client.listenerCount())  // Max ~10-15

// 3. Message Count
console.log(messages.length)  // Per room: max 100-200

// 4. Event Loop
performance.measure('renderTime')  // Sollte < 16ms sein

// 5. Network
// DevTools → Network → Filter "matrix"
// Requests sollten nach initialem Sync abnehmen
```

---

## 🆘 Letzte Hilfe: Debug Mode

**Aktiviere Debug Logging:**

```typescript
// In useMatrixClient.ts oben
if (typeof window !== 'undefined') {
  localStorage.setItem('mx_loglevel', 'debug')
  window.__debugMatrixClient = client  // Für Console Zugriff
}

// Browser Console
const client = window.__debugMatrixClient
client.getUser(userId)
client.getRoom(roomId)
client.getRooms()
```

**Matrix SDK Logging:**

```typescript
// In src/lib/matrix/client.ts
import { logger } from 'matrix-js-sdk'

if (process.env.NODE_ENV === 'development') {
  logger.setLevel('debug')
}
```

---

## 📞 Support Ressourcen

- **Matrix Help**: https://matrix.org/help/
- **SDK Issues**: https://github.com/matrix-org/matrix-js-sdk/issues
- **Community Chat**: https://matrix.to/#/#matrix:matrix.org
- **Spec**: https://spec.matrix.org/latest/

