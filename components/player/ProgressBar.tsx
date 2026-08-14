'use client';

import { useCallback, useRef, useState } from 'react';

interface ProgressBarProps {
  progressPercent: number;
  bufferedPercent: number;
  onSeek: (percent: number) => void;
}

export default function ProgressBar({ progressPercent, bufferedPercent, onSeek }: ProgressBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverPercent, setHoverPercent] = useState<number | null>(null);

  const getPercent = useCallback((clientX: number): number => {
    const bar = barRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    onSeek(getPercent(e.clientX));

    const onMouseMove = (ev: MouseEvent) => {
      onSeek(getPercent(ev.clientX));
    };
    const onMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [getPercent, onSeek]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    setIsDragging(true);
    onSeek(getPercent(touch.clientX));

    const onTouchMove = (ev: TouchEvent) => {
      ev.preventDefault();
      onSeek(getPercent(ev.touches[0].clientX));
    };
    const onTouchEnd = () => {
      setIsDragging(false);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
  }, [getPercent, onSeek]);

  return (
    // Touch-expandable: 4px resting, 12px hit area on interaction
    <div
      ref={barRef}
      id="player-progress-bar"
      className="relative w-full cursor-pointer group/progress"
      style={{ height: isDragging || hoverPercent !== null ? '12px' : '4px', transition: 'height 0.15s ease' }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onMouseMove={(e) => setHoverPercent(getPercent(e.clientX))}
      onMouseLeave={() => setHoverPercent(null)}
    >
      {/* Track background */}
      <div className="absolute inset-0 bg-white/20 rounded-full overflow-hidden">
        {/* Buffered */}
        <div
          className="absolute top-0 left-0 h-full bg-white/30 rounded-full transition-all duration-300"
          style={{ width: `${bufferedPercent}%` }}
        />
        {/* Progress */}
        <div
          className="absolute top-0 left-0 h-full bg-accent rounded-full"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Scrubber thumb */}
      <div
        className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-md opacity-0 group-hover/progress:opacity-100 transition-opacity pointer-events-none"
        style={{ left: `calc(${progressPercent}% - 6px)` }}
      />
    </div>
  );
}
