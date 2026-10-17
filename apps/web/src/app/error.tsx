'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/hooks/useTranslation'

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useTranslation()
  useEffect(() => {
    console.error('Unhandled UI error:', error)
  }, [error])

  return (
    <main className="flex h-dvh flex-col items-center justify-center gap-4 bg-background p-4 text-center">
      <h1 className="text-lg font-semibold text-foreground">{t('app.errorTitle')}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{t('app.errorDescription')}</p>
      <div className="flex gap-2">
        <Button onClick={reset}>{t('common.retry')}</Button>
        <Button variant="outline" onClick={() => window.location.reload()}>
          {t('app.reload')}
        </Button>
      </div>
    </main>
  )
}
