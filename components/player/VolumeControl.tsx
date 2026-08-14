'use client';

import { useRef, useState } from 'react';

interface VolumeControlProps {
  isMuted: boolean;
  volume: number;
  onMuteToggle: () => void;
  onVolumeChange: (v: number) => void;
}

export default function VolumeControl({ isMuted, volume, onMuteToggle, onVolumeChange }: VolumeControlProps) {
  const [showSlider, setShowSlider] = useState(false);

  const displayVolume = isMuted ? 0 : volume;

  return (
    <div
      className="flex items-center gap-1"
      onMouseEnter={() => setShowSlider(true)}
      onMouseLeave={() => setShowSlider(false)}
    >
      {/* Mute / Volume icon button — always visible, tap target 44x44 */}
      <button
        id="player-mute-btn"
        onClick={onMuteToggle}
        aria-label={isMuted ? 'Unmute' : 'Mute'}
        className="w-11 h-11 flex items-center justify-center text-text-secondary hover:text-accent active:scale-90 transition-all rounded-full"
      >
        {displayVolume === 0 ? (
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0 0 21 12c0-4.28-3-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
          </svg>
        ) : displayVolume < 0.5 ? (
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M18.5 12A4.5 4.5 0 0 0 16 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/>
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
          </svg>
        )}
      </button>

      {/* Volume slider — visible on hover (desktop only) */}
      <div
        className={`hidden md:flex items-center overflow-hidden transition-all duration-200 ${
          showSlider ? 'w-24 opacity-100' : 'w-0 opacity-0'
        }`}
      >
        <input
          id="player-volume-slider"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={displayVolume}
          onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
          className="w-full h-1 accent-accent cursor-pointer"
          aria-label="Volume"
        />
      </div>
    </div>
  );
}
