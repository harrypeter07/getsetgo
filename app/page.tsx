import type { Metadata } from 'next';
import Link from 'next/link';
import { listVideos } from '@/lib/supabase-client';
import type { Video } from '@/lib/types';

export const metadata: Metadata = {
  title: 'Browse Videos',
  description: 'Watch videos streamed adaptively for any connection speed.',
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
  return (
    <Link
      href={`/watch/${video.id}`}
      id={`video-card-${video.id}`}
      className="
        group block bg-surface rounded-2xl overflow-hidden border border-white/5
        hover:border-accent/30 hover:shadow-xl hover:shadow-accent/10
        transition-all duration-300 hover:-translate-y-1
      "
    >
      {/* Thumbnail */}
      <div className="relative aspect-video bg-surface-alt overflow-hidden">
        {video.thumbnail_url ? (
          <img
            src={video.thumbnail_url}
            alt={video.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-12 h-12 text-text-secondary/30">
              <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/>
            </svg>
          </div>
        )}

        {/* Duration badge */}
        {video.duration_seconds ? (
          <span className="absolute bottom-2 right-2 bg-black/80 text-white text-xs font-mono px-1.5 py-0.5 rounded-md">
            {formatDuration(video.duration_seconds)}
          </span>
        ) : null}

        {/* Play overlay */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
          <div className="w-12 h-12 rounded-full bg-accent/90 flex items-center justify-center shadow-lg">
            <svg viewBox="0 0 24 24" fill="white" className="w-6 h-6 ml-0.5">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="p-3.5">
        <h2 className="text-text-primary font-semibold text-sm line-clamp-2 leading-snug">
          {video.title}
        </h2>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {video.available_qualities.slice(-1).map((q) => (
            <span key={q} className="text-xs text-accent bg-accent/10 px-2 py-0.5 rounded-md font-medium">
              Up to {q}
            </span>
          ))}
          <span className="text-xs text-text-secondary">
            {video.view_count > 0 ? `${video.view_count.toLocaleString()} views` : 'New'}
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
    fetchError = 'Could not load videos. Please check your Supabase configuration.';
    console.error('[HomePage] Failed to load videos:', err);
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Hero */}
      <section className="mb-10 text-center py-6">
        <h1 className="text-text-primary text-3xl md:text-4xl font-bold tracking-tight">
          Stream Any Video,{' '}
          <span className="text-accent">Any Connection</span>
        </h1>
        <p className="mt-3 text-text-secondary text-sm md:text-base max-w-xl mx-auto">
          Adaptive bitrate streaming that automatically adjusts quality to your bandwidth — 
          from 240p on 2G to 1080p on fibre.
        </p>
        <Link
          href="/upload"
          id="home-upload-cta"
          className="
            inline-flex items-center gap-2 mt-6 px-6 py-3 min-h-[48px]
            bg-accent hover:bg-accent/80 text-white font-semibold text-sm rounded-xl
            transition-all active:scale-95 shadow-lg shadow-accent/25
          "
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"/>
          </svg>
          Upload a Video
        </Link>
      </section>

      {/* Error state */}
      {fetchError && (
        <div className="bg-danger/10 border border-danger/30 rounded-xl px-4 py-3 mb-8 text-danger text-sm text-center">
          {fetchError}
        </div>
      )}

      {/* Video grid */}
      {videos.length === 0 && !fetchError ? (
        <div className="text-center py-20">
          <div className="w-20 h-20 rounded-full bg-surface-alt flex items-center justify-center mx-auto mb-4">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-10 h-10 text-text-secondary/40">
              <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/>
            </svg>
          </div>
          <p className="text-text-secondary font-medium">No videos yet</p>
          <p className="text-text-secondary text-sm mt-1">Be the first to upload one!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {videos.map((video) => (
            <VideoCard key={video.id} video={video} />
          ))}
        </div>
      )}
    </div>
  );
}

