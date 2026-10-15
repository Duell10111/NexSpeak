"use client"

import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { CheckCircle2, Copy, KeyRound, ShieldAlert, ShieldCheck, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useMatrixClient } from "@/hooks/useMatrixClient"
import { useSecurity } from "@/components/nexspeak/security-context"
import { setupRecovery, verifyWithRecoveryKey } from "@/lib/matrix/security"
import { describeMatrixError } from "@/lib/matrix/errors"

function StatusRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? <ShieldCheck className="h-4 w-4 text-nx-online" /> : <ShieldAlert className="h-4 w-4 text-nx-idle" />}
      <span className={ok ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </div>
  )
}

function SetupRecovery({ onStarted, onDone }: { onStarted: () => void; onDone: () => void }) {
  const { client } = useMatrixClient()
  const [password, setPassword] = useState("")
  const [isBusy, setIsBusy] = useState(false)
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null)
  const [savedConfirmed, setSavedConfirmed] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!client) return
    // Keep this view mounted while the status flips to "set up", so the key can be shown.
    onStarted()
    setIsBusy(true)
    try {
      setRecoveryKey(await setupRecovery(client, password))
      setPassword("")
    } catch (error) {
      toast.error(describeMatrixError(error, "Einrichtung fehlgeschlagen."))
    } finally {
      setIsBusy(false)
    }
  }

  if (recoveryKey) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-foreground">
          Das ist dein Recovery-Schlüssel. Bewahre ihn sicher auf (z. B. im Passwort-Manager). Ohne ihn kannst du auf
          neuen Geräten ältere verschlüsselte Nachrichten nicht lesen.
        </p>
        <div className="flex items-start gap-2 rounded-md bg-muted p-3">
          <code className="flex-1 break-all font-mono text-sm text-foreground" data-testid="recovery-key">
            {recoveryKey}
          </code>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Kopieren"
            onClick={() => {
              void navigator.clipboard.writeText(recoveryKey).then(() => toast.success("Kopiert"))
            }}
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={savedConfirmed} onChange={(event) => setSavedConfirmed(event.target.checked)} />
          Ich habe den Schlüssel sicher gespeichert.
        </label>
        <Button className="w-full" disabled={!savedConfirmed} onClick={onDone}>
          Fertig
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Erstellt Schlüssel zur Verifizierung deiner Geräte und ein verschlüsseltes Backup deiner Nachrichtenschlüssel auf
        dem Server. Zur Bestätigung wird dein Passwort benötigt.
      </p>
      <div className="space-y-1">
        <Label htmlFor="setup-password">Passwort</Label>
        <Input
          id="setup-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={isBusy}
          required
        />
      </div>
      <Button type="submit" className="w-full" disabled={isBusy || !password}>
        {isBusy && <Spinner className="mr-2 h-4 w-4" />}
        Recovery-Schlüssel erstellen
      </Button>
    </form>
  )
}

function VerifyWithRecoveryKey({ onDone }: { onDone: () => void }) {
  const { client } = useMatrixClient()
  const [recoveryKey, setRecoveryKey] = useState("")
  const [isBusy, setIsBusy] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!client) return
    setIsBusy(true)
    try {
      const restored = await verifyWithRecoveryKey(client, recoveryKey)
      toast.success(
        restored > 0
          ? `Gerät verifiziert, ${restored} Nachrichtenschlüssel wiederhergestellt.`
          : "Gerät verifiziert.",
      )
      setRecoveryKey("")
      onDone()
    } catch (error) {
      toast.error(describeMatrixError(error, "Verifizierung fehlgeschlagen."))
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-2">
      <Label htmlFor="recovery-key">Recovery-Schlüssel</Label>
      <Input
        id="recovery-key"
        autoComplete="off"
        spellCheck={false}
        placeholder="EsT1 2345 …"
        value={recoveryKey}
        onChange={(event) => setRecoveryKey(event.target.value)}
        disabled={isBusy}
        className="font-mono"
      />
      <Button type="submit" className="w-full" disabled={isBusy || !recoveryKey.trim()}>
        {isBusy ? <Spinner className="mr-2 h-4 w-4" /> : <KeyRound className="mr-2 h-4 w-4" />}
        Mit Recovery-Schlüssel verifizieren
      </Button>
    </form>
  )
}

export function SecurityPanel() {
  const { client, isCryptoReady } = useMatrixClient()
  const { status, refreshStatus, startSelfVerification } = useSecurity()
  const [mode, setMode] = useState<"idle" | "setup">("idle")

  if (!client || !isCryptoReady) {
    return <p className="text-sm text-muted-foreground">Die Verschlüsselung ist auf diesem Gerät nicht verfügbar.</p>
  }
  if (!status) {
    return (
      <div className="flex justify-center py-6">
        <Spinner className="h-5 w-5 text-muted-foreground" />
      </div>
    )
  }

  const done = () => {
    setMode("idle")
    refreshStatus()
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1.5 rounded-lg bg-muted p-4">
        <StatusRow ok={status.isDeviceVerified} label={status.isDeviceVerified ? "Dieses Gerät ist verifiziert" : "Dieses Gerät ist nicht verifiziert"} />
        <StatusRow ok={status.hasRecovery} label={status.hasRecovery ? "Recovery-Schlüssel eingerichtet" : "Kein Recovery-Schlüssel eingerichtet"} />
        <StatusRow
          ok={Boolean(status.backupVersion)}
          label={status.backupVersion ? "Schlüssel-Backup aktiv" : "Kein Schlüssel-Backup auf diesem Gerät aktiv"}
        />
      </div>

      {!status.accountHasCrossSigning || mode === "setup" ? (
        <SetupRecovery onStarted={() => setMode("setup")} onDone={done} />
      ) : !status.isDeviceVerified ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Verifiziere dieses Gerät, um ältere verschlüsselte Nachrichten lesen zu können und anderen zu zeigen, dass du
            es bist.
          </p>
          <Button variant="outline" className="w-full" onClick={() => void startSelfVerification()}>
            <Smartphone className="mr-2 h-4 w-4" />
            Mit einem anderen Gerät verifizieren
          </Button>
          {status.hasRecovery && <VerifyWithRecoveryKey onDone={done} />}
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-nx-online" />
          Alles eingerichtet. Neue Nachrichtenschlüssel werden automatisch gesichert.
        </p>
      )}
    </div>
  )
}

/** Shown while this device is unverified on an account that uses cross-signing. */
export function SecurityBanner() {
  const { status } = useSecurity()
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  if (!status || dismissed || !status.accountHasCrossSigning || status.isDeviceVerified) return null

  return (
    <>
      <div className="flex shrink-0 items-center justify-center gap-3 bg-nx-idle px-4 py-1 text-xs font-medium text-black" role="status">
        <ShieldAlert className="h-3.5 w-3.5" />
        <span>Dieses Gerät ist nicht verifiziert – ältere verschlüsselte Nachrichten sind evtl. nicht lesbar.</span>
        <button onClick={() => setOpen(true)} className="font-semibold underline">
          Jetzt verifizieren
        </button>
        <button onClick={() => setDismissed(true)} className="opacity-70 hover:opacity-100" aria-label="Ausblenden">
          ×
        </button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Gerät verifizieren</DialogTitle>
            <DialogDescription>Bestätige, dass dieses Gerät zu dir gehört.</DialogDescription>
          </DialogHeader>
          <SecurityPanel />
        </DialogContent>
      </Dialog>
    </>
  )
}
