"use client"

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import type { MatrixClient } from "matrix-js-sdk"
import {
  CryptoEvent,
  VerificationPhase,
  VerificationRequestEvent,
  VerifierEvent,
  type ShowSasCallbacks,
  type VerificationRequest,
} from "matrix-js-sdk/lib/crypto-api/index.js"
import { toast } from "sonner"
import { CheckCircle2, ShieldAlert } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { getSecurityStatus, type SecurityStatus } from "@nexspeak/core/matrix/security"
import { describeMatrixError } from "@nexspeak/core/matrix/errors"
import { t as translate } from "@nexspeak/i18n"
import { useTranslation } from "@/hooks/useTranslation"

interface SecurityContextValue {
  status: SecurityStatus | null
  refreshStatus: () => void
  startSelfVerification: () => Promise<void>
}

const SecurityContext = createContext<SecurityContextValue | undefined>(undefined)

interface VerificationView {
  request: VerificationRequest
  phase: VerificationPhase
  sas: ShowSasCallbacks | null
  sasConfirmed: boolean
}

function VerificationDialog({ view, onClose }: { view: VerificationView; onClose: () => void }) {
  const { t } = useTranslation()
  const { request, phase, sas, sasConfirmed } = view
  const isIncoming = !request.initiatedByMe
  const otherDevice = request.otherDeviceId ? ` (${request.otherDeviceId})` : ""

  const cancel = () => {
    if (phase !== VerificationPhase.Done && phase !== VerificationPhase.Cancelled) {
      void request.cancel().catch(() => {})
    }
    onClose()
  }

  let body: ReactNode
  let footer: ReactNode = (
    <Button variant="outline" onClick={cancel}>
      {t("common.cancel")}
    </Button>
  )

  if (phase === VerificationPhase.Done) {
    body = (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <CheckCircle2 className="h-12 w-12 text-nx-online" />
        <p className="text-sm text-foreground">{t("verify.done")}</p>
      </div>
    )
    footer = <Button onClick={onClose}>{t("common.done")}</Button>
  } else if (phase === VerificationPhase.Cancelled) {
    body = (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <ShieldAlert className="h-12 w-12 text-destructive" />
        <p className="text-sm text-foreground">
          {request.cancellationCode === "m.mismatched_sas" ? t("verify.cancelledMismatch") : t("verify.cancelled")}
        </p>
      </div>
    )
    footer = <Button onClick={onClose}>{t("common.close")}</Button>
  } else if (sas?.sas.emoji) {
    body = (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t("verify.compareEmojis")}
        </p>
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-7">
          {sas.sas.emoji.map(([emoji, name], index) => (
            <div key={index} className="flex flex-col items-center gap-1 text-center">
              <span className="text-3xl">{emoji}</span>
              <span className="text-[10px] text-muted-foreground">{name}</span>
            </div>
          ))}
        </div>
        {sasConfirmed && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" /> {t("verify.waitingForOther")}
          </p>
        )}
      </div>
    )
    footer = (
      <>
        <Button
          variant="outline"
          onClick={() => {
            sas.mismatch()
          }}
          disabled={sasConfirmed}
        >
          {t("verify.noMatch")}
        </Button>
        <Button onClick={() => void sas.confirm()} disabled={sasConfirmed}>
          {t("verify.match")}
        </Button>
      </>
    )
  } else if (isIncoming && phase === VerificationPhase.Requested) {
    body = (
      <p className="text-sm text-muted-foreground">
        {request.isSelfVerification
          ? t("verify.incomingSelf", { device: otherDevice })
          : t("verify.incomingUser", { user: request.otherUserId })}
      </p>
    )
    footer = (
      <>
        <Button variant="outline" onClick={cancel}>
          {t("common.decline")}
        </Button>
        <Button onClick={() => void request.accept().catch((error: unknown) => toast.error(describeMatrixError(error)))}>
          {t("common.accept")}
        </Button>
      </>
    )
  } else {
    body = (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" />
        {phase === VerificationPhase.Requested
          ? t("verify.openOtherDevice")
          : t("verify.connecting")}
      </p>
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && cancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("verify.title")}</DialogTitle>
          <DialogDescription>{t("verify.description")}</DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SecurityProvider({ client, children }: { client: MatrixClient; children: ReactNode }) {
  const [status, setStatus] = useState<SecurityStatus | null>(null)
  const [view, setView] = useState<VerificationView | null>(null)

  const refreshStatus = useCallback(() => {
    if (!client.getCrypto()) return
    getSecurityStatus(client)
      .then(setStatus)
      .catch((error: unknown) => console.warn("Failed to read security status:", error))
  }, [client])

  useEffect(() => {
    queueMicrotask(refreshStatus)
    const events = [CryptoEvent.UserTrustStatusChanged, CryptoEvent.KeyBackupStatus, CryptoEvent.KeysChanged] as const
    events.forEach((event) => client.on(event, refreshStatus))
    return () => events.forEach((event) => client.removeListener(event, refreshStatus))
  }, [client, refreshStatus])

  const track = useCallback(
    (request: VerificationRequest) => {
      let startedVerifier = false

      const update = () => {
        const verifier = request.verifier
        // Whichever side starts SAS, both have to run verify() and show the emojis.
        if (verifier && !startedVerifier) {
          startedVerifier = true
          verifier.on(VerifierEvent.ShowSas, (sas) => {
            setView((current) => (current?.request === request ? { ...current, sas } : current))
          })
          verifier.verify().catch((error: unknown) => console.warn("Verification ended:", error))
        }

        if (request.phase === VerificationPhase.Ready && request.initiatedByMe && !request.verifier) {
          request.startVerification("m.sas.v1").then(update, (error: unknown) => {
            toast.error(describeMatrixError(error, translate("verify.startFailed")))
          })
        }

        if (request.phase === VerificationPhase.Done) refreshStatus()

        setView((current) => {
          if (current && current.request !== request) return current
          return {
            request,
            phase: request.phase,
            sas: current?.sas ?? null,
            sasConfirmed: current?.sasConfirmed ?? false,
          }
        })
      }

      request.on(VerificationRequestEvent.Change, update)
      update()
    },
    [refreshStatus],
  )

  // Incoming requests, e.g. when the user starts verification from Element.
  useEffect(() => {
    const onRequest = (request: VerificationRequest) => {
      if (request.phase === VerificationPhase.Cancelled || request.phase === VerificationPhase.Done) return
      track(request)
    }
    client.on(CryptoEvent.VerificationRequestReceived, onRequest)
    return () => {
      client.removeListener(CryptoEvent.VerificationRequestReceived, onRequest)
    }
  }, [client, track])

  const startSelfVerification = useCallback(async () => {
    const crypto = client.getCrypto()
    if (!crypto) {
      toast.error(translate("security.cryptoUnavailable"))
      return
    }
    try {
      track(await crypto.requestOwnUserVerification())
    } catch (error) {
      toast.error(describeMatrixError(error, translate("verify.startFailed")))
    }
  }, [client, track])

  // Wrap confirm so the dialog can show that we're waiting for the other side.
  const effectiveView =
    view?.sas && !view.sasConfirmed
      ? {
          ...view,
          sas: {
            ...view.sas,
            confirm: async () => {
              setView((current) => (current ? { ...current, sasConfirmed: true } : current))
              await view.sas?.confirm()
            },
          },
        }
      : view

  return (
    <SecurityContext.Provider value={{ status, refreshStatus, startSelfVerification }}>
      {children}
      {effectiveView && <VerificationDialog view={effectiveView} onClose={() => setView(null)} />}
    </SecurityContext.Provider>
  )
}

export function useSecurity(): SecurityContextValue {
  const context = useContext(SecurityContext)
  if (!context) throw new Error("useSecurity must be used within SecurityProvider")
  return context
}
