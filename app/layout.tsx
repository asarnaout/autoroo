import type { Metadata, Viewport } from 'next';
import './globals.css';
import './menu.css';

export const metadata: Metadata = {
  metadataBase: new URL(
    'https://autoroo-googly-getaway.asarnaout.chatgpt.site',
  ),
  title: 'Autoroo',
  description:
    'An endless, very jumpy driving game. Dodge traffic, clear buses, and keep the road going.',
  applicationName: 'Autoroo',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'Autoroo',
    title: 'Autoroo — Endless fun. Questionable driving.',
    description:
      'Dodge traffic, jump buses, and see how far you can go in this endless arcade driving game.',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        type: 'image/png',
        alt: 'Autoroo: Endless fun. Questionable driving. A blue sports car jumps over a purple bus in a glowing city at dusk.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Autoroo — Endless fun. Questionable driving.',
    description:
      'Dodge traffic, jump buses, and see how far you can go in this endless arcade driving game.',
    images: [
      {
        url: '/og.png',
        alt: 'Autoroo: Endless fun. Questionable driving. A blue sports car jumps over a purple bus in a glowing city at dusk.',
      },
    ],
  },
  icons: {
    icon: [
      { url: '/favicon.ico', type: 'image/x-icon', sizes: '16x16 32x32 48x48' },
      { url: '/icons/autoroo-16.png', type: 'image/png', sizes: '16x16' },
      { url: '/icons/autoroo-32.png', type: 'image/png', sizes: '32x32' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', type: 'image/png', sizes: '180x180' },
    ],
  },
  manifest: '/site.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Autoroo',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0e1a33',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
