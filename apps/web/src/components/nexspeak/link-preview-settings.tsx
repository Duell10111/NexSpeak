'use client'
import { useSyncExternalStore } from 'react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useTranslation } from '@/hooks/useTranslation'
import { defaultLinkPreviewSettings, loadLinkPreviewSettings, saveLinkPreviewSettings, subscribeLinkPreviewSettings } from '@/lib/link-preview-settings'

export function LinkPreviewSettingsPanel() {
  const { t } = useTranslation()
  const settings = useSyncExternalStore(subscribeLinkPreviewSettings, loadLinkPreviewSettings, defaultLinkPreviewSettings)
  return <div className="space-y-5">
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor="link-previews-enabled">{t('linkPreview.enabled')}</Label>
      <Switch id="link-previews-enabled" checked={settings.enabled} onCheckedChange={(enabled) => saveLinkPreviewSettings({ enabled })} />
    </div>
    <p className="text-xs text-muted-foreground">{t('linkPreview.privacy')}</p>
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor="link-previews-encrypted">{t('linkPreview.encrypted')}</Label>
      <Switch id="link-previews-encrypted" checked={settings.encrypted} disabled={!settings.enabled} onCheckedChange={(encrypted) => saveLinkPreviewSettings({ encrypted })} />
    </div>
    <p className="text-xs text-muted-foreground">{t('linkPreview.encryptedPrivacy')}</p>
  </div>
}
