'use client';

export default function BufferingSpinner() {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none"
      role="status"
      aria-label="Buffering"
    >
      {/* Outer glow ring */}
      <div className="relative">
        <div className="w-14 h-14 rounded-full border-4 border-white/10" />
        <div
          className="absolute inset-0 w-14 h-14 rounded-full border-4 border-transparent border-t-accent animate-spin"
          style={{ animationDuration: '0.8s' }}
        />
        {/* Center dot */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-2 h-2 rounded-full bg-accent/60" />
        </div>
      </div>
    </div>
  );
}
