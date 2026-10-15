'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Unhandled UI error:', error)
  }, [error])

  return (
    <main className="flex h-dvh flex-col items-center justify-center gap-4 bg-background p-4 text-center">
      <h1 className="text-lg font-semibold text-foreground">Etwas ist schiefgelaufen</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Ein unerwarteter Fehler ist aufgetreten. Du kannst es erneut versuchen oder die Seite neu laden.
      </p>
      <div className="flex gap-2">
        <Button onClick={reset}>Erneut versuchen</Button>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Neu laden
        </Button>
      </div>
    </main>
  )
}
