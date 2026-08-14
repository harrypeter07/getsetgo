import type { Metadata } from 'next';
import Link from 'next/link';
import { listVideos } from '@/lib/supabase-client';
import type { Video } from '@/lib/types';

export const metadata: Metadata = {
  title: 'Browse Videos — Netchinga',
  description: 'Watch videos adaptively streamed for any connection speed.',
};

export const revalidate = 60; // ISR: cache for 60s, revalidate in background

function formatDuration(seconds?: number): string {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function VideoCard({ video }: { video: Video }) {
  // Check if title indicates a part
  const isPart = /part\s*\d+/i.test(video.title) || /ep\s*\d+/i.test(video.title);
  const partMatch = video.title.match(/(part\s*\d+|ep\s*\d+)/i);

  return (
    <Link
      href={`/watch/${video.id}`}
      id={`video-card-${video.id}`}
      className="
        group relative block bg-surface rounded-2xl overflow-hidden border border-white/10
        hover:border-accent/60 hover:shadow-glow-red
        transition-all duration-300 hover:-translate-y-1.5 flex flex-col
      "
    >
      {/* Thumbnail Container */}
      <div className="relative aspect-video bg-surface-alt overflow-hidden">
        {video.thumbnail_url ? (
          <img
            src={video.thumbnail_url}
            alt={video.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-surface-alt to-[#121216] p-4 text-center">
            <div className="w-12 h-12 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-accent">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </div>
            <span className="text-xs text-text-secondary/60 font-mono">HLS Ready</span>
          </div>
        )}

        {/* Part Badge if applicable */}
        {isPart && partMatch && (
          <span className="absolute top-2.5 left-2.5 bg-accent text-white text-[11px] font-extrabold uppercase px-2 py-0.5 rounded-md shadow-md tracking-wider">
            {partMatch[0]}
          </span>
        )}

        {/* Duration badge */}
        {video.duration_seconds ? (
          <span className="absolute bottom-2.5 right-2.5 bg-black/85 text-white/90 text-xs font-mono px-2 py-0.5 rounded-md backdrop-blur-sm border border-white/10">
            {formatDuration(video.duration_seconds)}
          </span>
        ) : null}

        {/* Hover Play Overlay */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 bg-black/40 backdrop-blur-[2px]">
          <div className="w-14 h-14 rounded-full bg-accent text-white flex items-center justify-center shadow-glow-red transform scale-75 group-hover:scale-100 transition-transform duration-300">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 ml-1">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
        </div>
      </div>

      {/* Info Content */}
      <div className="p-4 flex-1 flex flex-col justify-between">
        <div>
          <h2 className="text-white font-bold text-base group-hover:text-accent transition-colors line-clamp-2 leading-snug">
            {video.title}
          </h2>
          {video.description && (
            <p className="mt-1 text-text-secondary text-xs line-clamp-1">{video.description}</p>
          )}
        </div>

        <div className="mt-3.5 pt-3 border-t border-white/5 flex items-center justify-between text-xs">
          {/* Qualities */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {video.available_qualities.map((q) => (
              <span key={q} className="bg-white/10 text-white/80 px-1.5 py-0.5 rounded text-[11px] font-medium border border-white/10">
                {q}
              </span>
            ))}
          </div>

          {/* View status */}
          <span className="text-text-secondary font-medium">
            {video.view_count > 0 ? `${video.view_count.toLocaleString()} views` : 'Ready to stream'}
          </span>
        </div>
      </div>
    </Link>
  );
}

export default async function HomePage() {
  let videos: Video[] = [];
  let fetchError: string | null = null;

  try {
    videos = await listVideos(24);
  } catch (err) {
    fetchError = 'Could not load videos. Please check your database configuration.';
    console.error('[HomePage] Failed to load videos:', err);
  }

  // Filter ready videos vs featured
  const readyVideos = videos.filter(v => v.status === 'ready' || v.master_manifest_url);
  const featuredVideo = readyVideos[0];

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-10 space-y-10">
      
      {/* Hero Banner Section */}
      {featuredVideo ? (
        <section className="relative rounded-3xl overflow-hidden border border-white/10 bg-gradient-to-r from-[#17171C] via-[#1A1A22] to-[#121216] shadow-glow-subtle">
          <div className="relative z-10 p-6 md:p-12 max-w-3xl flex flex-col items-start">
            
            {/* Tag pill */}
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/15 border border-accent/30 text-accent text-xs font-bold uppercase tracking-wider mb-4">
              <span className="w-2 h-2 rounded-full bg-accent animate-ping" />
              Featured Release
            </div>

            <h1 className="text-white font-heading text-3xl md:text-5xl font-extrabold tracking-tight leading-tight">
              {featuredVideo.title}
            </h1>

            <p className="mt-3 text-text-secondary text-sm md:text-base leading-relaxed line-clamp-2 max-w-2xl">
              {featuredVideo.description || 'Watch in multi-quality HLS adaptive streaming. Automatically optimizes for 2G, 3G, 4G, or High-speed WiFi.'}
            </p>

            <div className="mt-6 flex items-center flex-wrap gap-4">
              <Link
                href={`/watch/${featuredVideo.id}`}
                id="hero-play-cta"
                className="
                  inline-flex items-center gap-2.5 px-6 py-3.5
                  bg-gradient-to-r from-accent to-[#B81D24] hover:from-accent-hover hover:to-accent text-white font-bold text-sm md:text-base rounded-2xl
                  shadow-glow-red hover:shadow-xl transition-all active:scale-95 border border-white/10
                "
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path d="M8 5v14l11-7z"/>
                </svg>
                <span>Play Now</span>
              </Link>

              <div className="flex items-center gap-2 text-xs text-text-secondary font-mono bg-white/5 px-3 py-2 rounded-xl border border-white/5">
                <span>Qualities:</span>
                <span className="text-white font-bold">{featuredVideo.available_qualities.join(', ') || '360p, 480p, 720p'}</span>
              </div>
            </div>
          </div>

          {/* Decorative background glow */}
          <div className="absolute top-0 right-0 bottom-0 w-1/2 bg-gradient-to-l from-accent/10 to-transparent pointer-events-none opacity-40" />
        </section>
      ) : (
        <section className="text-center py-10 px-4 rounded-3xl bg-surface border border-white/5">
          <h1 className="text-white text-3xl md:text-4xl font-extrabold tracking-tight">
            Stream Any Video, <span className="text-accent">Any Speed</span>
          </h1>
          <p className="mt-3 text-text-secondary text-sm md:text-base max-w-xl mx-auto">
            Adaptive bitrate streaming that automatically adjusts quality to your connection bandwidth.
          </p>
        </section>
      )}

      {/* Error state */}
      {fetchError && (
        <div className="bg-danger/10 border border-danger/30 rounded-2xl px-5 py-4 text-danger text-sm text-center">
          {fetchError}
        </div>
      )}

      {/* Video Grid Section */}
      <section>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-white text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2">
            <span>Library Videos</span>
            <span className="text-xs font-mono font-normal text-text-secondary bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
              {videos.length} available
            </span>
          </h2>

          <Link
            href="/upload"
            className="text-xs text-accent hover:text-white font-semibold transition-colors flex items-center gap-1"
          >
            <span>+ Add Video</span>
          </Link>
        </div>

        {videos.length === 0 && !fetchError ? (
          <div className="text-center py-20 bg-surface/50 rounded-3xl border border-white/5">
            <div className="w-16 h-16 rounded-2xl bg-surface-alt flex items-center justify-center mx-auto mb-4 border border-white/10">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-text-secondary/40">
                <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/>
              </svg>
            </div>
            <p className="text-white font-bold text-base">No videos uploaded yet</p>
            <p className="text-text-secondary text-xs mt-1">Upload a video file to begin automated HLS transcoding.</p>
            <Link
              href="/upload"
              className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 bg-accent hover:bg-accent/80 text-white font-semibold text-xs rounded-xl shadow-glow-red transition-all"
            >
              Upload Video
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {videos.map((video) => (
              <VideoCard key={video.id} video={video} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
