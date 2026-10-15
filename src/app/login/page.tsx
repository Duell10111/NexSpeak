/**
 * Matrix Login Page
 */

'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { useMatrix } from '@/components/matrix-provider'
import { serverNameFromUserId } from '@/lib/matrix/errors'
import { AlertCircle } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const { session, login, isLoggingIn, loginError } = useMatrix()

  const [homeserver, setHomeserver] = useState('matrix.org')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  // Already logged in (or just logged in): go to the app.
  useEffect(() => {
    if (session) router.replace('/')
  }, [router, session])

  const handleUsernameChange = (value: string) => {
    setUsername(value)
    // A full MXID already names the server; keep both fields consistent.
    const serverName = serverNameFromUserId(value)
    if (serverName) setHomeserver(serverName)
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      await login(homeserver, username, password)
    } catch {
      // The error message is shown from context state.
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-linear-to-br from-background to-muted p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="mb-8 space-y-2 text-center">
          <h1 className="text-3xl font-bold">NexSpeak</h1>
          <p className="text-muted-foreground">Chatten und sprechen über Matrix</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Anmelden</CardTitle>
            <CardDescription>Melde dich mit deinem Matrix-Konto an</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
              {loginError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{loginError}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="homeserver">Homeserver</Label>
                <Input
                  id="homeserver"
                  type="text"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="matrix.org"
                  value={homeserver}
                  onChange={(event) => setHomeserver(event.target.value)}
                  disabled={isLoggingIn}
                  required
                />
                <p className="text-xs text-muted-foreground">z. B. matrix.org oder https://matrix.example.com</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="username">Benutzername</Label>
                <Input
                  id="username"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="alice oder @alice:matrix.org"
                  value={username}
                  onChange={(event) => handleUsernameChange(event.target.value)}
                  disabled={isLoggingIn}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Passwort</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={isLoggingIn}
                  required
                />
              </div>

              <Button type="submit" className="w-full" disabled={isLoggingIn}>
                {isLoggingIn ? (
                  <>
                    <Spinner className="mr-2 h-4 w-4" />
                    Anmeldung läuft…
                  </>
                ) : (
                  'Anmelden'
                )}
              </Button>
            </form>

            <div className="mt-6 text-center text-sm text-muted-foreground">
              <p>
                Noch kein Matrix-Konto?{' '}
                <a
                  href="https://matrix.org/try-matrix/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Jetzt erstellen
                </a>
              </p>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Dein Passwort wird nur an deinen Homeserver gesendet.
          <br />
          Das Zugriffstoken wird lokal in diesem Browser gespeichert.
        </p>
      </div>
    </div>
  )
}
