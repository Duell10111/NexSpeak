'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, Lock, Play } from 'lucide-react'
import { toast } from 'sonner'
import type { MatrixMessage } from '@nexspeak/core/matrix/types'
import { describeMatrixError } from '@nexspeak/core/matrix/errors'
import { useMatrixClient } from '@/hooks/useMatrixClient'
import { downloadMedia, loadMediaBlob, useMediaUrl } from '@/hooks/useMediaUrl'
import { useTranslation } from '@/hooks/useTranslation'
import { createMediaPlayback, type PlaybackState } from '@/lib/media-playback'

export function InlineMediaAttachment({ message }: { message: MatrixMessage }) {
  const { client } = useMatrixClient()
  const { t } = useTranslation()
  const element = useRef<HTMLMediaElement>(null)
  const playback = useRef<ReturnType<typeof createMediaPlayback> | null>(null)
  const [state, setState] = useState<PlaybackState>('idle')
  const [visible, setVisible] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const media = message.media
  const sourceKey = media?.file?.url ?? media?.mxc
  const thumbnail = media?.thumbnail
  // Only the separate thumbnail may load before Play; the media never enters the image cache.
  const showPoster = visible && (!thumbnail?.file || state === 'loading' || state === 'ready')
  const poster = useMediaUrl(showPoster ? client : null, thumbnail?.mxc, undefined, thumbnail?.file, thumbnail?.mimetype)

  useEffect(() => {
    const player = element.current
    if (!player || !client || !media) return
    const controller = createMediaPlayback(player, (signal) => loadMediaBlob(client, media, undefined, signal), setState)
    playback.current = controller
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting)
      if (!entry.isIntersecting) controller.release()
    })
    observer.observe(player)
    const hide = () => { if (document.visibilityState === 'hidden') controller.release() }
    document.addEventListener('visibilitychange', hide)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', hide)
      controller.dispose()
      playback.current = null
    }
    // Matrix media is immutable, even when timeline updates recreate its view model.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, message.roomId, message.id, sourceKey])

  const download = async () => {
    if (!client || !media) return
    setDownloading(true)
    try { await downloadMedia(client, media, message.body) }
    catch (error) { toast.error(describeMatrixError(error, t('chat.downloadFailed'))) }
    finally { setDownloading(false) }
  }

  return <div className="mt-1 max-w-sm overflow-hidden rounded-lg border border-border bg-secondary" data-testid="inline-media">
    {message.kind === 'video' ? (
      <video ref={(node) => { element.current = node }} controls preload="none" playsInline poster={poster ?? undefined}
        aria-label={message.body} className="max-h-80 w-full bg-black" />
    ) : (
      <audio ref={(node) => { element.current = node }} controls preload="none" aria-label={message.body} className="w-full" />
    )}
    <div className="flex items-center gap-2 px-3 py-2">
      {state !== 'ready' && <button type="button" disabled={!client || !sourceKey || state === 'loading'}
        onClick={() => void playback.current?.start()}
        className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-sm hover:bg-muted disabled:opacity-50"
        aria-label={t('chat.mediaPlay')}>
        <Play className="h-4 w-4" />{state === 'loading' ? t('chat.mediaLoading') : t('chat.mediaPlay')}
      </button>}
      <span className="min-w-0 flex-1 truncate text-sm" title={message.body}>{message.body}</span>
      {media?.file && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-label={t('chat.encryptedFile')} />}
      <button type="button" onClick={() => void download()} disabled={downloading || !client || !sourceKey}
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50" aria-label={t('chat.download')}>
        <Download className="h-4 w-4" />
      </button>
    </div>
    {state === 'failed' && <p role="alert" className="px-3 pb-2 text-xs text-destructive">{t('chat.mediaPlaybackFailed')}</p>}
  </div>
}
