import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '../lib/authContext';
import { VehicleIconProvider } from '../lib/vehicleIconContext';

export const metadata: Metadata = {
  title: 'Sikka Fleet – Fleet Management Application',
  description: 'Enterprise fleet management and plant geofencing system for Sikka LMC',
  icons: {
    icon: [
      { url: '/favicon.png', type: 'image/png' },
      { url: '/favicon.ico' },
    ],
    shortcut: '/favicon.png',
    apple: '/favicon.png',
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
          <VehicleIconProvider>{children}</VehicleIconProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
