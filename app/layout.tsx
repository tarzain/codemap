import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Codemap — explore your codebase as a map',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
