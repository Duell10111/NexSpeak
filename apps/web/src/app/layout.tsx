import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { ThemeProvider } from '@/components/theme-provider'
import { MatrixAuthProvider } from '@/components/matrix-provider'
import { Toaster } from '@/components/ui/sonner'
import { DocumentLanguage } from '@/hooks/useTranslation'
import { DesktopTrayLabels } from '@/components/nexspeak/desktop-tray'
import { DesktopDeepLinks } from '@/components/nexspeak/matrix-links'
import './globals.css'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: 'NexSpeak - Chat, Connect, Create',
  description: 'NexSpeak is a modern communication platform for communities and teams.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="de" suppressHydrationWarning>
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
