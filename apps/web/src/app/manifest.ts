import type { MetadataRoute } from 'next'

// Generated at build time (static export). Icons: apps/desktop/scripts/render-icons.mjs
export const dynamic = 'force-static'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'NexSpeak',
    short_name: 'NexSpeak',
    description: 'NexSpeak is a modern communication platform for communities and teams.',
    start_url: '/',
    display: 'standalone',
    background_color: '#313338',
    theme_color: '#1e1f22',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
