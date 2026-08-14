import type { Metadata } from 'next';
import './globals.css';
import Link from 'next/link';

export const metadata: Metadata = {
  title: {
    default: 'Netchinga — Adaptive Video Streaming',
    template: '%s | Netchinga',
  },
  description: 'Watch and share videos in any quality on any connection. Adaptive bitrate streaming for low-bandwidth environments.',
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
        <meta name="theme-color" content="#0B0B0F" />
      </head>
      <body className="min-h-screen flex flex-col bg-background">
        {/* Top nav */}
        <header className="sticky top-0 z-50 bg-surface/80 backdrop-blur-md border-b border-white/5">
          <nav className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
            <Link
              href="/"
              id="nav-home"
              className="flex items-center gap-2 text-text-primary font-bold text-base hover:text-accent transition-colors"
            >
              {/* Logo mark */}
              <span className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center text-white text-xs font-black">N</span>
              Netchinga
            </Link>

            <div className="flex items-center gap-1">
              <Link
                href="/"
                id="nav-browse"
                className="px-3 py-2 text-text-secondary hover:text-text-primary text-sm rounded-lg hover:bg-surface-alt transition-all"
              >
                Browse
              </Link>
              <Link
                href="/upload"
                id="nav-upload"
                className="
                  ml-1 px-4 py-2 min-h-[36px] flex items-center
                  bg-accent hover:bg-accent/80 text-white text-sm font-semibold rounded-lg
                  transition-all active:scale-95
                "
              >
                + Upload
              </Link>
            </div>
          </nav>
        </header>

        {/* Main content */}
        <main className="flex-1 w-full">
          {children}
        </main>

        {/* Footer */}
        <footer className="border-t border-white/5 py-6 px-4 text-center text-text-secondary text-xs">
          <p>Netchinga — Adaptive Low-Bandwidth Video Streaming</p>
        </footer>
      </body>
    </html>
  );
}

