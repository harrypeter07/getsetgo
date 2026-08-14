'use client';

import { RefObject, useState, useCallback } from 'react';
import ProgressBar from './ProgressBar';
import VolumeControl from './VolumeControl';
import type { QualityLevel, AudioTrack, SubtitleTrack } from './VideoPlayer';

// ─── Utilities ────────────────────────────────────────────────────────────────

export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function calculateBufferedPercent(video: HTMLVideoElement): number {
  if (!video.duration || !video.buffered.length) return 0;
  const t = video.currentTime;
  for (let i = 0; i < video.buffered.length; i++) {
    if (video.buffered.start(i) <= t && t <= video.buffered.end(i)) {
      return (video.buffered.end(i) / video.duration) * 100;
    }
  }
  return 0;
}

// ─── Settings panel types ─────────────────────────────────────────────────────

type SettingsView = 'main' | 'quality' | 'speed' | 'audio' | 'subtitles';

// ─── Props ────────────────────────────────────────────────────────────────────

interface ControlsProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  isPlaying: boolean;
  isMuted: boolean;
  isFullscreen: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  currentQuality: string;
  availableQualities: QualityLevel[];
  audioTracks: AudioTrack[];
  currentAudioTrack: number;
  subtitleTracks: SubtitleTrack[];
  currentSubtitleTrack: number;
  playbackSpeed: number;
  speedOptions: number[];
  onPlayPause: () => Promise<void> | void;
  onMuteToggle: () => void;
  onVolumeChange: (v: number) => void;
  onSeek: (percent: number) => void;
  onFullscreen: () => Promise<void> | void;
  onRotateLandscape: () => Promise<void> | void;
  onToggleCC: () => void;
  onSelectQuality: (index: number | 'auto') => void;
  onAudioTrackChange: (index: number) => void;
  onSubtitleTrackChange: (index: number) => void;
  onSpeedChange: (speed: number) => void;
}

// ─── Settings Panel ───────────────────────────────────────────────────────────

function SettingsPanel({
  view,
  setView,
  currentQuality,
  availableQualities,
  audioTracks,
  currentAudioTrack,
  subtitleTracks,
  currentSubtitleTrack,
  playbackSpeed,
  speedOptions,
  onSelectQuality,
  onAudioTrackChange,
  onSubtitleTrackChange,
  onSpeedChange,
  onClose,
}: {
  view: SettingsView;
  setView: (v: SettingsView) => void;
  currentQuality: string;
  availableQualities: QualityLevel[];
  audioTracks: AudioTrack[];
  currentAudioTrack: number;
  subtitleTracks: SubtitleTrack[];
  currentSubtitleTrack: number;
  playbackSpeed: number;
  speedOptions: number[];
  onSelectQuality: (index: number | 'auto') => void;
  onAudioTrackChange: (index: number) => void;
  onSubtitleTrackChange: (index: number) => void;
  onSpeedChange: (speed: number) => void;
  onClose: () => void;
}) {
  const sortedQualities = [...availableQualities].sort((a, b) => b.height - a.height);
  const activeAudioLabel = audioTracks[currentAudioTrack]?.label ?? 'Default Audio';
  const activeSubLabel   = currentSubtitleTrack === -1 ? 'Off' : (subtitleTracks[currentSubtitleTrack]?.label ?? 'On');

  return (
    <div
      className="absolute bottom-16 right-3 w-64 rounded-2xl overflow-hidden shadow-2xl border border-white/10 z-30 animate-fade-in"
      style={{ background: 'rgba(18,18,22,0.97)', backdropFilter: 'blur(24px)' }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Main menu */}
      {view === 'main' && (
        <ul className="py-2">
          {/* Quality */}
          <li>
            <button
              id="settings-quality"
              onClick={() => setView('quality')}
              className="w-full flex items-center justify-between px-4 py-3 text-sm text-white hover:bg-white/10 transition-colors"
            >
              <div className="flex items-center gap-3">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-gray-400">
                  <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12zM10 9h2.5v1.5H10V13h2.5v1.5H10V16h5v-2h-2.5v-1.5H15V9h-5V7h5V5.5h-5V9z"/>
                </svg>
                <span>Quality</span>
              </div>
              <div className="flex items-center gap-2 text-gray-400 text-xs">
                <span>{currentQuality}</span>
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>
              </div>
            </button>
          </li>

          {/* Audio & Language Tracks */}
          <li>
            <button
              id="settings-audio"
              onClick={() => setView('audio')}
              className="w-full flex items-center justify-between px-4 py-3 text-sm text-white hover:bg-white/10 transition-colors"
            >
              <div className="flex items-center gap-3">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-gray-400">
                  <path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2zm0 14H4V4h16v12zM6 12h8v2H6zm0-3h12v2H6zm0-3h12v2H6z"/>
                </svg>
                <span>Audio & Language</span>
              </div>
              <div className="flex items-center gap-2 text-gray-400 text-xs max-w-[100px] truncate">
                <span className="truncate">{activeAudioLabel}</span>
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3 shrink-0"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>
              </div>
            </button>
          </li>

          {/* Subtitles & Captions */}
          <li>
            <button
              id="settings-subtitles"
              onClick={() => setView('subtitles')}
              className="w-full flex items-center justify-between px-4 py-3 text-sm text-white hover:bg-white/10 transition-colors"
            >
              <div className="flex items-center gap-3">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-gray-400">
                  <path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z"/>
                </svg>
                <span>Subtitles / CC</span>
              </div>
              <div className="flex items-center gap-2 text-gray-400 text-xs max-w-[100px] truncate">
                <span className="truncate">{activeSubLabel}</span>
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3 shrink-0"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>
              </div>
            </button>
          </li>

          {/* Playback speed */}
          <li>
            <button
              id="settings-speed"
              onClick={() => setView('speed')}
              className="w-full flex items-center justify-between px-4 py-3 text-sm text-white hover:bg-white/10 transition-colors"
            >
              <div className="flex items-center gap-3">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-gray-400">
                  <path d="M10 8v8l6-4zm11-.27L19.1 5.27A10.98 10.98 0 0 0 12.05 3C6.48 3 2 7.48 2 13s4.48 10 10.05 10C17.08 23 21.15 18.84 21.73 13.5H19.7c-.55 4-3.99 7-8.15 7-4.4 0-8-3.6-8-8s3.6-8 8-8c2.21 0 4.2.91 5.65 2.35L13.5 11h8V3z"/>
                </svg>
                <span>Playback Speed</span>
              </div>
              <div className="flex items-center gap-2 text-gray-400 text-xs">
                <span>{playbackSpeed === 1 ? 'Normal' : `${playbackSpeed}×`}</span>
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>
              </div>
            </button>
          </li>
        </ul>
      )}

      {/* Quality sub-menu */}
      {view === 'quality' && (
        <>
          <button onClick={() => setView('main')} className="w-full flex items-center gap-2 px-4 py-3 text-sm text-gray-400 hover:text-white border-b border-white/10 transition-colors">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z"/></svg>
            Quality
          </button>
          <ul className="py-2 max-h-60 overflow-y-auto">
            <li>
              <button id="quality-auto" onClick={() => { onSelectQuality('auto'); onClose(); }}
                className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${currentQuality === 'Auto' ? 'text-red-500 font-semibold' : 'text-white hover:bg-white/10'}`}>
                <span>Auto</span>
                {currentQuality === 'Auto' && <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>}
              </button>
            </li>
            {sortedQualities.map((q) => (
              <li key={q.index}>
                <button id={`quality-${q.label}`} onClick={() => { onSelectQuality(q.index); onClose(); }}
                  className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${currentQuality === q.label ? 'text-red-500 font-semibold' : 'text-white hover:bg-white/10'}`}>
                  <span>{q.label}</span>
                  {currentQuality === q.label && <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Audio & Language sub-menu */}
      {view === 'audio' && (
        <>
          <button onClick={() => setView('main')} className="w-full flex items-center gap-2 px-4 py-3 text-sm text-gray-400 hover:text-white border-b border-white/10 transition-colors">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z"/></svg>
            Audio & Language
          </button>
          <ul className="py-2 max-h-60 overflow-y-auto">
            {audioTracks.length === 0 ? (
              <li className="px-4 py-3 text-xs text-gray-400">Default Audio Track</li>
            ) : (
              audioTracks.map((t) => (
                <li key={t.index}>
                  <button id={`audio-${t.index}`} onClick={() => { onAudioTrackChange(t.index); onClose(); }}
                    className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${currentAudioTrack === t.index ? 'text-red-500 font-semibold' : 'text-white hover:bg-white/10'}`}>
                    <span>{t.label}</span>
                    {currentAudioTrack === t.index && <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>}
                  </button>
                </li>
              ))
            )}
          </ul>
        </>
      )}

      {/* Subtitles & Captions sub-menu */}
      {view === 'subtitles' && (
        <>
          <button onClick={() => setView('main')} className="w-full flex items-center gap-2 px-4 py-3 text-sm text-gray-400 hover:text-white border-b border-white/10 transition-colors">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z"/></svg>
            Subtitles / CC
          </button>
          <ul className="py-2 max-h-60 overflow-y-auto">
            <li>
              <button id="sub-off" onClick={() => { onSubtitleTrackChange(-1); onClose(); }}
                className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${currentSubtitleTrack === -1 ? 'text-red-500 font-semibold' : 'text-white hover:bg-white/10'}`}>
                <span>Off</span>
                {currentSubtitleTrack === -1 && <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>}
              </button>
            </li>
            {subtitleTracks.map((t) => (
              <li key={t.index}>
                <button id={`sub-${t.index}`} onClick={() => { onSubtitleTrackChange(t.index); onClose(); }}
                  className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${currentSubtitleTrack === t.index ? 'text-red-500 font-semibold' : 'text-white hover:bg-white/10'}`}>
                  <span>{t.label}</span>
                  {currentSubtitleTrack === t.index && <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Speed sub-menu */}
      {view === 'speed' && (
        <>
          <button onClick={() => setView('main')} className="w-full flex items-center gap-2 px-4 py-3 text-sm text-gray-400 hover:text-white border-b border-white/10 transition-colors">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z"/></svg>
            Playback Speed
          </button>
          <ul className="py-2">
            {speedOptions.map((s) => (
              <li key={s}>
                <button id={`speed-${s}`} onClick={() => { onSpeedChange(s); onClose(); }}
                  className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-colors ${playbackSpeed === s ? 'text-red-500 font-semibold' : 'text-white hover:bg-white/10'}`}>
                  <span>{s === 1 ? 'Normal' : `${s}×`}</span>
                  {playbackSpeed === s && <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ─── Main Controls Component ──────────────────────────────────────────────────

export default function Controls({
  videoRef,
  isPlaying,
  isMuted,
  isFullscreen,
  currentTime,
  duration,
  volume,
  currentQuality,
  availableQualities,
  audioTracks,
  currentAudioTrack,
  subtitleTracks,
  currentSubtitleTrack,
  playbackSpeed,
  speedOptions,
  onPlayPause,
  onMuteToggle,
  onVolumeChange,
  onSeek,
  onFullscreen,
  onRotateLandscape,
  onToggleCC,
  onSelectQuality,
  onAudioTrackChange,
  onSubtitleTrackChange,
  onSpeedChange,
}: ControlsProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [settingsView, setSettingsView] = useState<SettingsView>('main');

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPercent = videoRef.current ? calculateBufferedPercent(videoRef.current) : 0;

  const toggleSettings = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowSettings((v) => !v);
    setSettingsView('main');
  }, []);

  const openAudioMenu = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowSettings(true);
    setSettingsView('audio');
  }, []);

  const closeSettings = useCallback(() => {
    setShowSettings(false);
    setSettingsView('main');
  }, []);

  const isCCOn = currentSubtitleTrack !== -1;

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10" onClick={closeSettings}>
      {/* Big gradient — fades bottom to visible */}
      <div
        className="absolute inset-x-0 bottom-0 pointer-events-none"
        style={{
          height: '180px',
          background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 60%, transparent 100%)',
        }}
      />

      {/* Settings panel */}
      {showSettings && (
        <SettingsPanel
          view={settingsView}
          setView={setSettingsView}
          currentQuality={currentQuality}
          availableQualities={availableQualities}
          audioTracks={audioTracks}
          currentAudioTrack={currentAudioTrack}
          subtitleTracks={subtitleTracks}
          currentSubtitleTrack={currentSubtitleTrack}
          playbackSpeed={playbackSpeed}
          speedOptions={speedOptions}
          onSelectQuality={onSelectQuality}
          onAudioTrackChange={onAudioTrackChange}
          onSubtitleTrackChange={onSubtitleTrackChange}
          onSpeedChange={onSpeedChange}
          onClose={closeSettings}
        />
      )}

      <div className="relative">
        {/* ── Progress bar ─────────────────────────────────────────── */}
        <ProgressBar
          progressPercent={progressPercent}
          bufferedPercent={bufferedPercent}
          onSeek={onSeek}
        />

        {/* ── Control row ──────────────────────────────────────────── */}
        <div className="flex items-center h-14 px-3 gap-1">

          {/* Async Play / Pause */}
          <button
            id="player-play-pause"
            onClick={async (e) => {
              e.stopPropagation();
              await onPlayPause();
            }}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="w-11 h-11 flex items-center justify-center text-white hover:scale-110 active:scale-90 transition-transform"
          >
            {isPlaying ? (
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
                <path d="M8 5v14l11-7z"/>
              </svg>
            )}
          </button>

          {/* Skip forward 10s */}
          <button
            id="player-skip-forward"
            onClick={(e) => {
              e.stopPropagation();
              const v = videoRef.current;
              if (v) v.currentTime = Math.min(v.currentTime + 10, v.duration);
            }}
            aria-label="Skip forward 10 seconds"
            className="w-9 h-9 flex items-center justify-center text-white/70 hover:text-white hover:scale-110 active:scale-90 transition-all"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path d="M18 13c0 3.31-2.69 6-6 6s-6-2.69-6-6 2.69-6 6-6v4l5-5-5-5v4c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8h-2z"/>
              <text x="11.5" y="15" fontSize="6" fill="currentColor" textAnchor="middle" fontWeight="bold">10</text>
            </svg>
          </button>

          {/* Volume */}
          <VolumeControl
            isMuted={isMuted}
            volume={volume}
            onMuteToggle={onMuteToggle}
            onVolumeChange={onVolumeChange}
          />

          {/* Time */}
          <span className="text-white text-xs tabular-nums whitespace-nowrap ml-1 hidden sm:block" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
            {formatTime(currentTime)}
            <span className="text-white/50 mx-1">/</span>
            {formatTime(duration)}
          </span>

          {/* Speed badge (shows when not 1x) */}
          {playbackSpeed !== 1 && (
            <span className="hidden sm:flex items-center text-xs font-bold text-red-500 bg-red-500/20 px-2 py-0.5 rounded-md ml-1">
              {playbackSpeed}×
            </span>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* 1-Tap Closed Captions (CC) ON/OFF Button */}
          <button
            id="player-cc-btn"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCC();
            }}
            aria-label={isCCOn ? 'Turn captions off' : 'Turn captions on'}
            title={isCCOn ? 'Captions ON' : 'Captions OFF'}
            className={`w-10 h-10 flex items-center justify-center font-bold text-xs rounded-lg transition-all ${
              isCCOn
                ? 'text-white bg-red-600 shadow-glow-red border border-red-500 scale-105'
                : 'text-white/70 hover:text-white hover:scale-110 active:scale-90'
            }`}
          >
            <span className="border-2 border-current px-1 py-0.5 rounded text-[10px] leading-none tracking-tighter">
              CC
            </span>
          </button>

          {/* 1-Tap Audio & Language Button */}
          <button
            id="player-audio-lang-btn"
            onClick={openAudioMenu}
            aria-label="Audio and Language settings"
            title="Audio & Language"
            className="w-10 h-10 flex items-center justify-center text-white/70 hover:text-white hover:scale-110 active:scale-90 transition-all"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2zm0 14H4V4h16v12zM6 12h8v2H6zm0-3h12v2H6zm0-3h12v2H6z"/>
            </svg>
          </button>

          {/* Rotate / Phone Orientation Button */}
          <button
            id="player-rotate-btn"
            onClick={async (e) => {
              e.stopPropagation();
              await onRotateLandscape();
            }}
            aria-label="Rotate to landscape phone view"
            title="Rotate to Landscape"
            className="w-10 h-10 flex items-center justify-center text-white/70 hover:text-white hover:scale-110 active:scale-90 transition-all md:hidden"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path d="M16.48 2.52c3.27 1.55 5.61 4.72 5.97 8.48h1.5c-.47-4.66-3.32-8.58-7.29-10.3l1.82-1.82L17.07-2l-4.24 4.24 4.24 4.24 1.41-1.41-1.99-2.55zM7.52 21.48c-3.27-1.55-5.61-4.72-5.97-8.48h-1.5c.47 4.66 3.32 8.58 7.29 10.3l-1.82 1.82 1.41 1.41 4.24-4.24-4.24-4.24-1.41 1.41 1.99 2.55zM6 8h12v8H6V8z"/>
            </svg>
          </button>

          {/* Settings (gear) */}
          <button
            id="player-settings-btn"
            onClick={toggleSettings}
            aria-label="Settings"
            className={`w-10 h-10 flex items-center justify-center transition-all ${showSettings ? 'text-red-500 rotate-45' : 'text-white/70 hover:text-white'}`}
            style={{ transition: 'color 0.2s, transform 0.3s' }}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.6-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.6.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.47.47 0 0 0-.12.61l1.92 3.32a.49.49 0 0 0 .6.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96a.49.49 0 0 0 .6-.22l1.92-3.32a.47.47 0 0 0-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6-3.6z"/>
            </svg>
          </button>

          {/* Async Fullscreen */}
          <button
            id="player-fullscreen-btn"
            onClick={async (e) => {
              e.stopPropagation();
              await onFullscreen();
            }}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            className="w-10 h-10 flex items-center justify-center text-white/70 hover:text-white hover:scale-110 active:scale-90 transition-all"
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
    </div>
  );
}
