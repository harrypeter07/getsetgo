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
  const [isHovering, setIsHovering] = useState(false);
  const [hoverPercent, setHoverPercent] = useState(0);

  const getPercent = useCallback((clientX: number): number => {
    const bar = barRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    onSeek(getPercent(e.clientX));

    const onMouseMove = (ev: MouseEvent) => onSeek(getPercent(ev.clientX));
    const onMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [getPercent, onSeek]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    const touch = e.touches[0];
    setIsDragging(true);
    onSeek(getPercent(touch.clientX));

    const onTouchMove = (ev: TouchEvent) => { ev.preventDefault(); onSeek(getPercent(ev.touches[0].clientX)); };
    const onTouchEnd  = () => { setIsDragging(false); document.removeEventListener('touchmove', onTouchMove); document.removeEventListener('touchend', onTouchEnd); };
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
  }, [getPercent, onSeek]);

  const active = isDragging || isHovering;

  return (
    /* Hit-area wrapper — 24px tall for easy touch, but only shows thin bar */
    <div
      ref={barRef}
      id="player-progress-bar"
      className="relative w-full cursor-pointer flex items-center"
      style={{ height: '24px', padding: '0 0' }}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => { setIsHovering(false); }}
      onMouseMove={(e) => setHoverPercent(getPercent(e.clientX))}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    >
      {/* Track */}
      <div
        className="absolute left-0 right-0 rounded-full overflow-visible transition-all duration-150"
        style={{
          height: active ? '5px' : '3px',
          bottom: '10px',
          background: 'rgba(255,255,255,0.2)',
        }}
      >
        {/* Buffered */}
        <div
          className="absolute top-0 left-0 h-full rounded-full"
          style={{ width: `${bufferedPercent}%`, background: 'rgba(255,255,255,0.3)', transition: 'width 0.3s' }}
        />
        {/* Hover preview */}
        {isHovering && (
          <div
            className="absolute top-0 left-0 h-full rounded-full"
            style={{ width: `${hoverPercent}%`, background: 'rgba(255,255,255,0.15)' }}
          />
        )}
        {/* Progress — Netflix red */}
        <div
          className="absolute top-0 left-0 h-full rounded-full"
          style={{ width: `${progressPercent}%`, background: '#E50914' }}
        />
        {/* Scrubber thumb — only on hover/drag */}
        {active && (
          <div
            className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg"
            style={{ left: `calc(${progressPercent}% - 8px)`, transition: 'left 0.05s' }}
          />
        )}
      </div>
    </div>
  );
}
