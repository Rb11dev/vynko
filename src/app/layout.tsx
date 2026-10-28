import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from '@/context/AuthContext';

export const metadata: Metadata = {
  title: 'VYNKO · Talk More. Feel Closer.',
  description: 'Audio calls, video calls, instant messaging and shareable meeting links in one place.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: [{ media: '(prefers-color-scheme: dark)', color: '#0b0a15' }, { media: '(prefers-color-scheme: light)', color: '#f7f6fc' }] };

// Applies the saved theme before first paint to avoid a flash of the wrong colours.
const themeScript = `try{var t=localStorage.getItem('vynko-theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body><AuthProvider>{children}</AuthProvider></body>
    </html>
  );
}
