/**
 * Matrix Login Page
 */

'use client'

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { useMatrix } from '@/components/matrix-provider'
import { describeLoginError, resolveHomeserverUrl, serverNameFromUserId } from '@nexspeak/core/matrix/errors'
import {
  fetchLoginOptions,
  rememberSsoHomeserver,
  ssoLoginUrl,
  takeSsoHomeserver,
  type LoginOptions,
} from '@nexspeak/core/matrix/sso'
import { desktopBridge } from '@/lib/desktop'
import { getPendingLink, subscribePendingLink, takePendingLink } from '@/lib/pending-link'
import { useTranslation } from '@/hooks/useTranslation'
import { LOCALE_NAMES, LOCALES } from '@nexspeak/i18n'
import { AlertCircle } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const { session, login, loginWithToken, isLoggingIn, loginError } = useMatrix()
  const { t, locale, setLocale } = useTranslation()

  const [homeserver, setHomeserver] = useState('matrix.org')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginOptions, setLoginOptions] = useState<LoginOptions | null>(null)
  const [ssoNotice, setSsoNotice] = useState<string | null>(null)
  const pendingLink = useSyncExternalStore(subscribePendingLink, getPendingLink, () => null)
  const handledToken = useRef<string | null>(null)

  // How the entered homeserver lets people log in (password, SSO), once typing pauses.
  useEffect(() => {
    const target = homeserver.trim()
    if (!target) return
    let cancelled = false
    const timer = setTimeout(() => {
      resolveHomeserverUrl(target)
        .then(fetchLoginOptions)
        .then((options) => !cancelled && setLoginOptions(options))
        .catch(() => !cancelled && setLoginOptions(null))
    }, 500)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [homeserver])

  // Back from SSO: the web app gets ?loginToken=…, the desktop app a nexspeak://sso link.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('loginToken')
    const token = fromUrl ?? (pendingLink?.kind === 'sso' ? takePendingLink(['sso'])?.loginToken : null)
    if (!token || token === handledToken.current) return
    handledToken.current = token
    if (fromUrl) window.history.replaceState(null, '', window.location.pathname)
    const homeserverUrl = takeSsoHomeserver()
    if (homeserverUrl) {
      loginWithToken(homeserverUrl, token).catch(() => {})
    } else {
      // A one-off reaction to the URL or deep link, not state derived from props.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSsoNotice(t('login.ssoExpired'))
    }
  }, [pendingLink, loginWithToken, t])

  const startSso = async (identityProviderId?: string) => {
    setSsoNotice(null)
    try {
      const homeserverUrl = await resolveHomeserverUrl(homeserver.trim())
      rememberSsoHomeserver(homeserverUrl)
      if (desktopBridge()) {
        // The desktop app logs in through the default browser, which returns via nexspeak://sso.
        window.open(ssoLoginUrl(homeserverUrl, 'nexspeak://sso', identityProviderId), '_blank')
        setSsoNotice(t('login.ssoInBrowser'))
      } else {
        window.location.assign(ssoLoginUrl(homeserverUrl, `${window.location.origin}/login`, identityProviderId))
      }
    } catch (error) {
      setSsoNotice(describeLoginError(error))
    }
  }

  // Unknown (yet): offer the password form, every homeserver used to have it.
  const showPassword = loginOptions?.password ?? true
  const ssoProviders = loginOptions?.sso

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
          {/* eslint-disable-next-line @next/next/no-img-element -- static export: no image optimization */}
          <img src="/icon-192.png" alt="" width={72} height={72} className="mx-auto mb-4" />
          <h1 className="text-3xl font-bold">NexSpeak</h1>
          <p className="text-muted-foreground">{t('login.tagline')}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t('login.title')}</CardTitle>
            <CardDescription>{t('login.description')}</CardDescription>
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
                <Label htmlFor="homeserver">{t('login.homeserver')}</Label>
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
                <p className="text-xs text-muted-foreground">{t('login.homeserverHint')}</p>
              </div>

              {ssoNotice && (
                <Alert>
                  <AlertDescription>{ssoNotice}</AlertDescription>
                </Alert>
              )}

              {ssoProviders && (
                <div className="space-y-2">
                  {(ssoProviders.length > 0 ? ssoProviders : [null]).map((provider) => (
                    <Button
                      key={provider?.id ?? 'sso'}
                      type="button"
                      variant="outline"
                      className="w-full"
                      disabled={isLoggingIn}
                      onClick={() => void startSso(provider?.id)}
                    >
                      {provider ? t('login.ssoWith', { name: provider.name }) : t('login.sso')}
                    </Button>
                  ))}
                  {showPassword && (
                    <div className="flex items-center gap-3 text-xs uppercase text-muted-foreground">
                      <span className="h-px flex-1 bg-border" />
                      {t('login.or')}
                      <span className="h-px flex-1 bg-border" />
                    </div>
                  )}
                </div>
              )}

              {showPassword && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="username">{t('login.username')}</Label>
                    <Input
                      id="username"
                      type="text"
                      autoComplete="username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder={t('login.usernamePlaceholder')}
                      value={username}
                      onChange={(event) => handleUsernameChange(event.target.value)}
                      disabled={isLoggingIn}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">{t('login.password')}</Label>
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
                        {t('login.submitting')}
                      </>
                    ) : (
                      t('login.submit')
                    )}
                  </Button>
                </>
              )}
            </form>

            <div className="mt-6 text-center text-sm text-muted-foreground">
              <p>
                {t('login.noAccount')}{' '}
                <a
                  href="https://matrix.org/try-matrix/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  {t('login.createAccount')}
                </a>
              </p>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          {t('login.privacyPassword')}
          <br />
          {t('login.privacyToken')}
        </p>

        <div className="flex justify-center gap-3 text-xs" role="group" aria-label={t('settings.language')}>
          {LOCALES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setLocale(option)}
              aria-pressed={locale === option}
              className={locale === option ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground'}
            >
              {LOCALE_NAMES[option]}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
