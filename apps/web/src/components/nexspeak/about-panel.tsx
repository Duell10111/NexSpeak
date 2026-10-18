"use client"

import { useEffect, useState } from "react"
import { Bug, Code2, ShieldCheck } from "lucide-react"
import { DesktopUpdateSection } from "@/components/nexspeak/desktop-update"
import { Spinner } from "@/components/ui/spinner"
import { useTranslation } from "@/hooks/useTranslation"
import {
  APP_VERSION,
  GIT_COMMIT,
  ISSUES_URL,
  LICENSE_URL,
  loadThirdPartyLicenses,
  sourceUrl,
  type ThirdPartyLicense,
} from "@/lib/about"

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
      {children}
    </a>
  )
}

function LicenseList() {
  const { t } = useTranslation()
  const [licenses, setLicenses] = useState<ThirdPartyLicense[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadThirdPartyLicenses()
      .then((list) => !cancelled && setLicenses(list))
      .catch((error: unknown) => {
        console.warn(error)
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (failed) return <p className="text-xs text-muted-foreground">{t("about.licensesFailed")}</p>
  if (!licenses) return <Spinner className="h-4 w-4 text-muted-foreground" />

  return (
    <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-2 text-xs" aria-label={t("about.thirdParty")}>
      {licenses.map((entry) => (
        <li key={`${entry.name}@${entry.version}`}>
          <details>
            <summary className="flex cursor-pointer gap-2">
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                {entry.name} <span className="font-normal text-muted-foreground">{entry.version}</span>
              </span>
              <span className="shrink-0 text-muted-foreground">{entry.license}</span>
            </summary>
            <div className="mt-1 space-y-1 pl-3">
              {entry.repository?.startsWith("https://") && <ExternalLink href={entry.repository}>{entry.repository}</ExternalLink>}
              {entry.text && (
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-[10px] text-muted-foreground">
                  {entry.text}
                </pre>
              )}
            </div>
          </details>
        </li>
      ))}
    </ul>
  )
}

export function AboutPanel() {
  const { t } = useTranslation()
  const shortCommit = GIT_COMMIT.slice(0, 7)

  return (
    <div className="space-y-5 text-sm">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- static export: no image optimization */}
        <img src="/icon-192.png" alt="" width={48} height={48} />
        <div>
          <p className="text-base font-semibold text-foreground">NexSpeak</p>
          <p className="text-xs text-muted-foreground" data-testid="about-version">
            {t("about.version", { version: APP_VERSION })}
            {shortCommit && (
              <>
                {" · "}
                <ExternalLink href={sourceUrl()}>{shortCommit}</ExternalLink>
              </>
            )}
          </p>
        </div>
      </div>

      <DesktopUpdateSection />

      <div className="space-y-2">
        <p className="flex items-start gap-2 text-muted-foreground">
          <Code2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t("about.license")} <ExternalLink href={LICENSE_URL}>AGPL-3.0-or-later</ExternalLink> ·{" "}
            <ExternalLink href={sourceUrl()}>{t("about.source")}</ExternalLink>
          </span>
        </p>
        <p className="flex items-start gap-2 text-muted-foreground">
          <Bug className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t("about.feedback")} <ExternalLink href={ISSUES_URL}>{t("about.openIssue")}</ExternalLink>
          </span>
        </p>
        <p className="flex items-start gap-2 text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t("about.noTracking")}</span>
        </p>
      </div>

      <div className="space-y-2">
        <p className="font-semibold text-foreground">{t("about.thirdParty")}</p>
        <p className="text-xs text-muted-foreground">{t("about.thirdPartyHint")}</p>
        <LicenseList />
      </div>
    </div>
  )
}
