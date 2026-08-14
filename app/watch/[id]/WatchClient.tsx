'use client';

import { useState } from 'react';
import Link from 'next/link';
import VideoPlayer from '@/components/player/VideoPlayer';
import type { VideoResponse, Video } from '@/lib/types';

interface WatchClientProps {
  video: VideoResponse;
  allVideos?: Video[];
}

export default function WatchClient({ video, allVideos = [] }: WatchClientProps) {
  const [dataSaverMode, setDataSaverMode] = useState(false);
  const [currentQuality, setCurrentQuality] = useState<string>('Auto');
  const [copied, setCopied] = useState(false);

  function formatDuration(seconds?: number): string {
    if (!seconds) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  const handleCopyLink = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  // Filter other videos (excluding current) for episode/parts section
  const otherVideos = allVideos.filter(v => v.id !== video.id && v.status === 'ready');

  return (
    <div className="max-w-6xl mx-auto px-0 md:px-6 py-0 md:py-6 space-y-6">
      
      {/* Player Frame with subtle red ambient shadow */}
      <div className="w-full md:rounded-3xl overflow-hidden shadow-2xl bg-black border border-white/10 relative">
        <VideoPlayer
          masterManifestUrl={video.masterManifestUrl}
          poster={video.thumbnailUrl}
          dataSaverMode={dataSaverMode}
          onQualityChange={(level) => setCurrentQuality(level.label)}
        />
      </div>

      {/* Primary Video Info Panel */}
      <div className="px-4 md:px-0 py-2 space-y-6">
        
        {/* Header row: Title + Actions */}
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 pb-6 border-b border-white/10">
          <div className="flex-1 min-w-0 space-y-2">
            
            {/* Title */}
            <h1 className="text-white font-heading text-2xl md:text-3xl font-extrabold tracking-tight leading-snug">
              {video.title}
            </h1>

            {/* Badges & Meta strip */}
            <div className="flex items-center flex-wrap gap-2.5 text-xs text-text-secondary">
              
              {/* Duration */}
              {video.durationSeconds ? (
                <span className="flex items-center gap-1 bg-white/5 border border-white/10 px-2.5 py-1 rounded-lg font-mono text-white/90">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-accent">
                    <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
                  </svg>
                  {formatDuration(video.durationSeconds)}
                </span>
              ) : null}

              {/* Active Stream Quality */}
              <span className="flex items-center gap-1.5 bg-accent/15 border border-accent/30 text-accent font-semibold px-2.5 py-1 rounded-lg">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                Stream: {currentQuality}
              </span>

              {/* Qualities list */}
              {video.availableQualities.length > 0 && (
                <div className="flex items-center gap-1">
                  <span className="text-white/40">Available:</span>
                  {video.availableQualities.map(q => (
                    <span key={q} className="bg-white/5 px-2 py-0.5 rounded text-[11px] font-mono text-white/80 border border-white/5">
                      {q}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Action buttons (Data Saver & Share) */}
          <div className="flex items-center gap-2.5 shrink-0 pt-1">
            
            {/* Data Saver Toggle */}
            <button
              id="data-saver-toggle"
              onClick={() => setDataSaverMode((v) => !v)}
              aria-pressed={dataSaverMode}
              className={`
                flex items-center gap-2 px-3.5 py-2.5 rounded-xl border text-xs font-bold
                transition-all min-h-[44px] active:scale-95 shadow-sm
                ${dataSaverMode
                  ? 'bg-accent border-accent text-white shadow-glow-red'
                  : 'bg-surface border-white/10 text-white/90 hover:bg-surface-alt hover:border-white/20'
                }
              `}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8zm-1-13h2v6h-2zm0 8h2v2h-2z"/>
              </svg>
              <span>Data Saver {dataSaverMode ? 'ON' : 'OFF'}</span>
            </button>

            {/* Share Link */}
            <button
              id="share-link-btn"
              onClick={handleCopyLink}
              className="
                flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-white/10
                bg-surface hover:bg-surface-alt text-white/90 text-xs font-semibold
                transition-all active:scale-95 min-h-[44px]
              "
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-accent">
                <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L7.05 10.81C6.5 10.31 5.79 10 5 10c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z"/>
              </svg>
              <span>{copied ? 'Copied Link!' : 'Share'}</span>
            </button>
          </div>
        </div>

        {/* Description Section */}
        {video.description && (
          <div className="bg-surface/60 border border-white/5 rounded-2xl p-4 md:p-5 backdrop-blur-sm">
            <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-1.5">About this Video</h3>
            <p className="text-text-secondary text-sm leading-relaxed">{video.description}</p>
          </div>
        )}

        {/* Parts & Related Videos Section */}
        {otherVideos.length > 0 && (
          <div className="pt-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold text-lg md:text-xl tracking-tight flex items-center gap-2">
                <span>More Parts & Videos</span>
                <span className="text-xs font-mono text-accent bg-accent/10 px-2 py-0.5 rounded-md border border-accent/20">
                  {otherVideos.length}
                </span>
              </h3>

              <Link href="/" className="text-xs text-accent hover:text-white font-semibold transition-colors">
                View All →
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {otherVideos.slice(0, 6).map((item) => (
                <Link
                  key={item.id}
                  href={`/watch/${item.id}`}
                  className="
                    group flex items-center gap-3 bg-surface p-2.5 rounded-2xl border border-white/5
                    hover:border-accent/40 hover:bg-surface-alt transition-all duration-200
                  "
                >
                  <div className="w-24 aspect-video rounded-xl bg-surface-alt overflow-hidden shrink-0 relative">
                    {item.thumbnail_url ? (
                      <img src={item.thumbnail_url} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-accent/10 text-accent">
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                          <path d="M8 5v14l11-7z"/>
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-white font-bold text-xs group-hover:text-accent transition-colors line-clamp-2">
                      {item.title}
                    </h4>
                    <span className="text-[11px] text-text-secondary mt-1 block">
                      {item.available_qualities.join(', ') || 'Ready'}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Navigation Back Link */}
        <div className="pt-4">
          <Link
            href="/"
            id="watch-back-link"
            className="inline-flex items-center gap-2 text-text-secondary hover:text-white text-xs font-semibold transition-colors group"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-accent group-hover:-translate-x-1 transition-transform">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
            </svg>
            Back to Library
          </Link>
        </div>
      </div>
    </div>
  );
}
