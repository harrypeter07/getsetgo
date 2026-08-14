'use client';

import { RefObject, useCallback } from 'react';
import ProgressBar from './ProgressBar';
import VolumeControl from './VolumeControl';

// ─── Pure utility functions (separately testable) ─────────────────────────────

/**
 * Formats seconds into "H:MM:SS" or "M:SS"
 */
export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Returns the percentage of video that is buffered (0-100)
 */
export function calculateBufferedPercent(video: HTMLVideoElement): number {
  if (!video.duration || !video.buffered.length) return 0;
  const currentTime = video.currentTime;
  for (let i = 0; i < video.buffered.length; i++) {
    if (video.buffered.start(i) <= currentTime && currentTime <= video.buffered.end(i)) {
      return (video.buffered.end(i) / video.duration) * 100;
    }
  }
  return 0;
}

/**
 * Seeks the video to the given percent (0-100) of its duration
 */
export function handleSeek(video: HTMLVideoElement, percent: number): void {
  if (!video.duration) return;
  video.currentTime = Math.max(0, Math.min(1, percent / 100)) * video.duration;
}

// ─── Controls Component ───────────────────────────────────────────────────────

interface ControlsProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  isPlaying: boolean;
  isMuted: boolean;
  isFullscreen: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  currentQuality: string;
  onPlayPause: () => void;
  onMuteToggle: () => void;
  onVolumeChange: (v: number) => void;
  onSeek: (percent: number) => void;
  onFullscreen: () => void;
  onQualityToggle: () => void;
}

export default function Controls({
  videoRef,
  isPlaying,
  isMuted,
  isFullscreen,
  currentTime,
  duration,
  volume,
  currentQuality,
  onPlayPause,
  onMuteToggle,
  onVolumeChange,
  onSeek,
  onFullscreen,
  onQualityToggle,
}: ControlsProps) {
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPercent = videoRef.current ? calculateBufferedPercent(videoRef.current) : 0;

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 group/controls">
      {/* Gradient background */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent pointer-events-none" />

      {/* Progress bar strip — sits above the control row */}
      <div className="relative px-0">
        <ProgressBar
          progressPercent={progressPercent}
          bufferedPercent={bufferedPercent}
          onSeek={onSeek}
        />
      </div>

      {/* Control row: 56px height on mobile */}
      <div className="relative flex items-center h-14 px-3 gap-2">
        {/* Play / Pause */}
        <button
          id="player-play-pause"
          onClick={onPlayPause}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="w-11 h-11 flex items-center justify-center text-white hover:text-accent active:scale-90 transition-all rounded-full"
        >
          {isPlaying ? (
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
              <path d="M8 5v14l11-7z"/>
            </svg>
          )}
        </button>

        {/* Time display */}
        <span className="text-text-secondary text-xs tabular-nums whitespace-nowrap hidden sm:block">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Volume control (desktop: hover-reveal slider; mobile: mute toggle only) */}
        <VolumeControl
          isMuted={isMuted}
          volume={volume}
          onMuteToggle={onMuteToggle}
          onVolumeChange={onVolumeChange}
        />

        {/* Quality gear button */}
        <button
          id="player-quality-btn"
          onClick={(e) => { e.stopPropagation(); onQualityToggle(); }}
          aria-label="Select quality"
          className="w-11 h-11 flex items-center justify-center text-text-secondary hover:text-accent active:scale-90 transition-all rounded-full"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.6-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.6.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.47.47 0 0 0-.12.61l1.92 3.32a.49.49 0 0 0 .6.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96a.49.49 0 0 0 .6-.22l1.92-3.32a.47.47 0 0 0-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
          </svg>
          <span className="text-xs ml-0.5 hidden md:inline">{currentQuality}</span>
        </button>

        {/* Fullscreen */}
        <button
          id="player-fullscreen-btn"
          onClick={onFullscreen}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          className="w-11 h-11 flex items-center justify-center text-text-secondary hover:text-accent active:scale-90 transition-all rounded-full"
        >
          {isFullscreen ? (
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
