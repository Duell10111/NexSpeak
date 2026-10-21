/** Decode a single frame off the UI thread; animated files never run an idle animation. */
self.onmessage = async (event: MessageEvent<{ id: number; blob: Blob; size: number }>) => {
  const { id, blob, size } = event.data
  try {
    const bitmap = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(size, size)
    const context = canvas.getContext('2d')!
    const scale = Math.min(size / bitmap.width, size / bitmap.height)
    const width = bitmap.width * scale
    const height = bitmap.height * scale
    context.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height)
    bitmap.close()
    self.postMessage({ id, blob: await canvas.convertToBlob({ type: 'image/png' }) })
  } catch {
    self.postMessage({ id, blob: null })
  }
}
