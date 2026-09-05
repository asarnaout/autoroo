import type { Metadata } from 'next';
import './globals.css';
import './menu.css';

export const metadata: Metadata = {
  title: 'Autoroo',
  description:
    'An endless, very jumpy driving game. Dodge traffic, clear buses, and keep the road going.',
  applicationName: 'Autoroo',
  icons: { icon: '/favicon.svg' },
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
