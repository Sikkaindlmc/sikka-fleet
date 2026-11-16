import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from '../lib/authContext';
import { VehicleIconProvider } from '../lib/vehicleIconContext';
import AppVersionChecker from '../components/AppVersionChecker';
import InstallPrompt from '../components/InstallPrompt';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0f172a',
};

export const metadata: Metadata = {
  title: 'Sikka Fleet',
  description: 'Enterprise fleet management and plant geofencing system for Sikka LMC',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'Sikka Fleet',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        url: '/icons/maskable-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      { url: '/favicon.ico' },
    ],
    shortcut: '/icons/icon-192.png',
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full bg-slate-50 antialiased">
      <body className="h-full text-slate-900 selection:bg-emerald-500 selection:text-white">
        <AuthProvider>
          <VehicleIconProvider>
            {children}
            <AppVersionChecker />
            <InstallPrompt />
          </VehicleIconProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
