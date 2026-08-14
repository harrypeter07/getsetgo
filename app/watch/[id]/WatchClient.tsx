'use client';

import { useState } from 'react';
import Link from 'next/link';
import VideoPlayer from '@/components/player/VideoPlayer';
import type { VideoResponse } from '@/lib/types';

interface WatchClientProps {
  video: VideoResponse;
}

export default function WatchClient({ video }: WatchClientProps) {
  const [dataSaverMode, setDataSaverMode] = useState(false);
  const [currentQuality, setCurrentQuality] = useState<string>('Auto');

  function formatDuration(seconds?: number): string {
    if (!seconds) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  return (
    <div className="max-w-5xl mx-auto px-0 md:px-4 py-0 md:py-6">
      {/* Player — full width on mobile, contained on desktop */}
      <div className="w-full md:rounded-2xl overflow-hidden shadow-2xl bg-black">
        <VideoPlayer
          masterManifestUrl={video.masterManifestUrl}
          poster={video.thumbnailUrl}
          dataSaverMode={dataSaverMode}
          onQualityChange={(level) => setCurrentQuality(level.label)}
        />
      </div>

      {/* Info panel */}
      <div className="px-4 md:px-0 py-5">
        {/* Title + data saver toggle */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-text-primary text-xl md:text-2xl font-bold leading-snug">
              {video.title}
            </h1>
            <div className="mt-2 flex items-center flex-wrap gap-3 text-text-secondary text-xs">
              {video.durationSeconds && (
                <span>⏱ {formatDuration(video.durationSeconds)}</span>
              )}
              <span className="text-accent font-medium">▶ {currentQuality}</span>
              {video.availableQualities.length > 0 && (
                <span>Available: {video.availableQualities.join(', ')}</span>
              )}
            </div>
          </div>

          {/* Data Saver toggle */}
          <div className="shrink-0">
            <button
              id="data-saver-toggle"
              onClick={() => setDataSaverMode((v) => !v)}
              aria-pressed={dataSaverMode}
              className={`
                flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold
                transition-all min-h-[44px]
                ${dataSaverMode
                  ? 'bg-accent/20 border-accent text-accent'
                  : 'bg-surface border-white/10 text-text-secondary hover:border-white/20'
                }
              `}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path d="M12 1a11 11 0 1 0 0 22A11 11 0 0 0 12 1zm0 20a9 9 0 1 1 0-18 9 9 0 0 1 0 18zm-1-5h2v2h-2v-2zm0-8h2v6h-2V8z"/>
              </svg>
              Data Saver {dataSaverMode ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>

        {/* Description */}
        {video.description && (
          <div className="mt-4 bg-surface rounded-xl p-4">
            <p className="text-text-secondary text-sm leading-relaxed">{video.description}</p>
          </div>
        )}

        {/* Back link */}
        <div className="mt-6">
          <Link
            href="/"
            id="watch-back-link"
            className="inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary text-sm transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
            </svg>
            Back to all videos
          </Link>
        </div>
      </div>
    </div>
  );
}
