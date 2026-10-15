import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { ThemeProvider } from '@/components/theme-provider'
import { MatrixAuthProvider } from '@/components/matrix-provider'
import { Toaster } from '@/components/ui/sonner'
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
          <MatrixAuthProvider>
            {children}
          </MatrixAuthProvider>
          <Toaster position="bottom-right" richColors closeButton />
        </ThemeProvider>
        {/* Only on Vercel; elsewhere the analytics script doesn't exist and just 404s. */}
        {process.env.VERCEL && <Analytics />}
      </body>
    </html>
  )
}
