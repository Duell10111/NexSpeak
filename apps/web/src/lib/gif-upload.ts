import type { Gif } from '@nexspeak/core/gifs'
import type { GifUpload } from '@nexspeak/core/matrix/messages'

interface Frame { data: Blob; mimetype: string; width: number; height: number; durationMs?: number }

/** One-off on send: the first frame as JPEG, decoded by the browser's (hardware) video decoder. */
async function firstVideoFrame(data: Blob): Promise<Frame> {
  const video = document.createElement('video')
  const url = URL.createObjectURL(data)
  try {
    video.muted = true
    video.preload = 'auto'
    video.src = url
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve()
      video.onerror = () => reject(new Error('Could not decode the GIF video'))
    })
    const bitmap = await createImageBitmap(video)
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
      const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
      const duration = Number.isFinite(video.duration) ? video.duration * 1000 : undefined
      return { data: jpeg, mimetype: 'image/jpeg', width: bitmap.width, height: bitmap.height, durationMs: duration }
    } finally {
      bitmap.close()
    }
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

/** Download the picked rendition, so recipients never contact the GIF provider. */
export async function prepareGifUpload(gif: Gif, signal?: AbortSignal): Promise<GifUpload> {
  const { upload } = gif
  const response = await fetch(upload.url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
  if (!response.ok) throw new Error(`GIF download failed with status ${response.status}`)
  const data = new Blob([await response.arrayBuffer()], { type: upload.mimetype })
  const frame = upload.mimetype.startsWith('video/') ? await firstVideoFrame(data).catch(() => undefined) : undefined
  return {
    title: gif.title,
    data,
    mimetype: upload.mimetype,
    width: upload.width || frame?.width || 0,
    height: upload.height || frame?.height || 0,
    durationMs: upload.duration ? upload.duration * 1000 : frame?.durationMs,
    thumbnail: frame && { data: frame.data, mimetype: frame.mimetype, width: frame.width, height: frame.height },
  }
}
