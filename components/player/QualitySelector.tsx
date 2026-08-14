'use client';

import { useEffect, useCallback } from 'react';

interface QualityLevel {
  index: number;
  label: string;
  height: number;
}

interface QualitySelectorProps {
  qualities: QualityLevel[];
  currentQuality: string;
  qualityLocked: boolean;
  onSelect: (index: number | 'auto') => void;
  onClose: () => void;
}

export default function QualitySelector({
  qualities,
  currentQuality,
  qualityLocked,
  onSelect,
  onClose,
}: QualitySelectorProps) {
  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const isActive = useCallback(
    (label: string) => currentQuality === label,
    [currentQuality]
  );

  const sortedQualities = [...qualities].sort((a, b) => b.height - a.height);

  return (
    <>
      {/* Backdrop for mobile bottom sheet */}
      <div
        className="fixed inset-0 z-20 md:hidden bg-black/50"
        onClick={onClose}
        aria-hidden
      />

      {/* Mobile: bottom sheet */}
      <div
        className="
          fixed bottom-0 left-0 right-0 z-30
          md:absolute md:bottom-16 md:right-2 md:left-auto md:w-36
          bg-surface border border-white/10
          rounded-t-2xl md:rounded-xl
          shadow-2xl
          animate-in slide-in-from-bottom duration-200
          md:animate-none
        "
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle — mobile only */}
        <div className="md:hidden flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        {/* Title */}
        <div className="px-4 py-3 border-b border-white/10">
          <h3 className="text-text-primary text-sm font-semibold">Video Quality</h3>
        </div>

        {/* Options list */}
        <ul className="py-2" role="listbox" aria-label="Video quality options">
          {/* Auto option */}
          <li>
            <button
              id="quality-option-auto"
              role="option"
              aria-selected={!qualityLocked}
              onClick={() => onSelect('auto')}
              className={`
                w-full flex items-center justify-between px-4 py-3.5
                text-sm transition-colors min-h-[44px]
                ${!qualityLocked
                  ? 'text-accent font-semibold bg-accent/10'
                  : 'text-text-primary hover:bg-surface-alt active:bg-surface-alt'
                }
              `}
            >
              <span>Auto</span>
              {!qualityLocked && (
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
              )}
            </button>
          </li>

          {/* Quality levels (highest first) */}
          {sortedQualities.map((q) => (
            <li key={q.index}>
              <button
                id={`quality-option-${q.label}`}
                role="option"
                aria-selected={qualityLocked && isActive(q.label)}
                onClick={() => onSelect(q.index)}
                className={`
                  w-full flex items-center justify-between px-4 py-3.5
                  text-sm transition-colors min-h-[44px]
                  ${qualityLocked && isActive(q.label)
                    ? 'text-accent font-semibold bg-accent/10'
                    : 'text-text-primary hover:bg-surface-alt active:bg-surface-alt'
                  }
                `}
              >
                <span>{q.label}</span>
                {qualityLocked && isActive(q.label) && (
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                  </svg>
                )}
              </button>
            </li>
          ))}
        </ul>

        {/* Safe area padding for mobile */}
        <div className="md:hidden pb-safe-area-inset-bottom h-4" />
      </div>
    </>
  );
}
