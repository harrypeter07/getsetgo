import type { Metadata } from 'next';
import './globals.css';
import Link from 'next/link';

export const metadata: Metadata = {
  title: {
    default: 'Netchinga — Adaptive HD Video Streaming',
    template: '%s | Netchinga',
  },
  description: 'Ultra-fast adaptive bitrate streaming platform. Automatically transcoded for low-bandwidth 2G to 4K speeds.',
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: 'any' },
    ],
    apple: '/icon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0F0F12" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
      </head>
      <body className="min-h-screen flex flex-col bg-background selection:bg-accent selection:text-white">
        {/* Glassmorphic Netflix-style Header */}
        <header className="sticky top-0 z-50 glass-nav transition-all duration-300">
          <nav className="max-w-7xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between gap-4">
            
            {/* Logo */}
            <Link
              href="/"
              id="nav-home"
              className="flex items-center gap-2.5 group transition-transform duration-200 hover:scale-[1.02]"
            >
              {/* Custom N emblem */}
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-accent to-[#B81D24] flex items-center justify-center text-white text-xs font-black shadow-glow-red border border-white/20">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              </div>
              <span className="font-heading font-extrabold text-lg md:text-xl tracking-tight text-white group-hover:text-accent transition-colors">
                NETCHINGA
              </span>
            </Link>

            {/* Navigation links */}
            <div className="flex items-center gap-1 md:gap-2">
              <Link
                href="/"
                id="nav-browse"
                className="px-3.5 py-2 text-text-secondary hover:text-white text-sm font-medium rounded-lg hover:bg-white/5 transition-all flex items-center gap-1.5"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 opacity-70">
                  <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/>
                </svg>
                <span className="hidden sm:inline">Browse</span>
              </Link>

              <Link
                href="/upload"
                id="nav-upload"
                className="
                  ml-2 px-4 py-2 min-h-[38px] flex items-center gap-2
                  bg-gradient-to-r from-accent to-[#B81D24] hover:from-accent-hover hover:to-accent text-white text-sm font-semibold rounded-xl
                  shadow-glow-red hover:shadow-lg hover:shadow-accent/40
                  transition-all duration-200 active:scale-95 border border-white/10
                "
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                  <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                </svg>
                <span>Upload</span>
              </Link>
            </div>
          </nav>
        </header>

        {/* Main content */}
        <main className="flex-1 w-full">
          {children}
        </main>

        {/* Footer */}
        <footer className="border-t border-white/5 bg-[#0A0A0C] py-8 px-4 mt-16 text-center text-text-secondary text-xs">
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="font-mono text-emerald-400">Stream Engine Active</span>
              <span className="text-white/20">•</span>
              <span>HLS Adaptive Bitrate (AMD GPU Accelerated)</span>
            </div>
            <p className="text-white/40">© {new Date().getFullYear()} Netchinga — Premium Low-Bandwidth Video Streaming</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
