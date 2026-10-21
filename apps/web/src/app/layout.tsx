import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { ThemeProvider } from '@/components/theme-provider'
import { MatrixAuthProvider } from '@/components/matrix-provider'
import { Toaster } from '@/components/ui/sonner'
import { DocumentLanguage } from '@/hooks/useTranslation'
import { DesktopTrayLabels } from '@/components/nexspeak/desktop-tray'
import { DesktopDeepLinks } from '@/components/nexspeak/matrix-links'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })

export const metadata: Metadata = {
  title: 'NexSpeak - Chat, Connect, Create',
  description: 'NexSpeak is a modern communication platform for communities and teams.',
}

export const viewport: Viewport = {
  themeColor: '#1e1f22',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="de" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <DocumentLanguage />
          <DesktopTrayLabels />
          <DesktopDeepLinks />
          <MatrixAuthProvider>
            {children}
          </MatrixAuthProvider>
          <Toaster position="bottom-right" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  )
}
