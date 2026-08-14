'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import Hls, { type HlsConfig, Events, ErrorData, LevelSwitchedData } from 'hls.js';
import Controls from './Controls';
import BufferingSpinner from './BufferingSpinner';

interface VideoPlayerProps {
  masterManifestUrl: string;
  poster?: string;
  onQualityChange?: (level: { label: string; height: number }) => void;
  dataSaverMode?: boolean;
}

export interface QualityLevel { index: number; label: string; height: number; }
export interface AudioTrack   { index: number; label: string; lang: string; }

const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

// Language code map for human-readable labels
const LANG_MAP: Record<string, string> = {
  eng: 'English',
  en:  'English',
  hin: 'Hindi',
  hi:  'Hindi',
  kor: 'Korean',
  ko:  'Korean',
  spa: 'Spanish',
  es:  'Spanish',
  fre: 'French',
  fr:  'French',
  ger: 'German',
  de:  'German',
  jpn: 'Japanese',
  ja:  'Japanese',
  zho: 'Chinese',
  zh:  'Chinese',
};

function formatAudioLabel(track: { name?: string; lang?: string }, index: number): string {
  const langKey = track.lang?.toLowerCase() ?? '';
  const langName = LANG_MAP[langKey] ?? track.name ?? track.lang;
  if (langName) return `${langName} (Audio ${index + 1})`;
  return `Audio Track ${index + 1}`;
}

export default function VideoPlayer({
  masterManifestUrl,
  poster,
  onQualityChange,
  dataSaverMode = false,
}: VideoPlayerProps) {
  const videoRef     = useRef<HTMLVideoElement>(null);
  const hlsRef       = useRef<Hls | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep callback ref to prevent HLS destruction on parent re-renders
  const onQualityChangeRef = useRef(onQualityChange);
  useEffect(() => {
    onQualityChangeRef.current = onQualityChange;
  }, [onQualityChange]);

  // Player state
  const [isBuffering,        setIsBuffering]        = useState(true);
  const [error,              setError]              = useState<string | null>(null);
  const [isPlaying,          setIsPlaying]          = useState(false);
  const [isMuted,            setIsMuted]            = useState(false);
  const [isFullscreen,       setIsFullscreen]       = useState(false);
  const [currentTime,        setCurrentTime]        = useState(0);
  const [duration,           setDuration]           = useState(0);
  const [volume,             setVolume]             = useState(1);
  const [showControls,       setShowControls]       = useState(true);

  // Quality
  const [availableQualities, setAvailableQualities] = useState<QualityLevel[]>([]);
  const [currentQuality,     setCurrentQuality]     = useState<string>('Auto');
  const qualityLockedRef = useRef(false);

  // Audio tracks
  const [audioTracks,        setAudioTracks]        = useState<AudioTrack[]>([]);
  const [currentAudioTrack,  setCurrentAudioTrack]  = useState(0);

  // Playback speed
  const [playbackSpeed,      setPlaybackSpeed]      = useState(1);

  // ── Auto-hide controls ───────────────────────────────────────────────────
  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowControls(false), 3000);
  }, []);

  const showControlsNow = useCallback(() => {
    setShowControls(true);
    scheduleHide();
  }, [scheduleHide]);

  // Always show controls when paused
  useEffect(() => {
    if (!isPlaying) {
      setShowControls(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    } else {
      scheduleHide();
    }
  }, [isPlaying, scheduleHide]);

  // ── HLS initialisation ───────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !masterManifestUrl) return;

    if (!Hls.isSupported()) {
      video.src = masterManifestUrl;
      setIsBuffering(false);
      return;
    }

    const hlsConfig: Partial<HlsConfig> = {
      startLevel: -1,
      abrEwmaDefaultEstimate: 1_000_000,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      capLevelToPlayerSize: true,
      progressive: true,
      lowLatencyMode: false,
    };

    const hls = new Hls(hlsConfig);
    hlsRef.current = hls;

    hls.loadSource(masterManifestUrl);
    hls.attachMedia(video);

    // Quality levels available
    hls.on(Events.MANIFEST_PARSED, async () => {
      const levels = hls.levels;
      setAvailableQualities(
        levels.map((l, i) => ({ index: i, label: `${l.height}p`, height: l.height }))
      );
      if (dataSaverMode) hls.autoLevelCapping = 0;
      try {
        await video.play();
      } catch (err) {
        console.log('[VideoPlayer] Autoplay prevented:', err);
      }
    });

    // Current quality changed by ABR (smooth transition without restarting video)
    hls.on(Events.LEVEL_SWITCHED, (_, data: LevelSwitchedData) => {
      const level = hls.levels[data.level];
      if (level && !qualityLockedRef.current) {
        const label = `${level.height}p`;
        setCurrentQuality(label);
        onQualityChangeRef.current?.({ label, height: level.height });
      }
    });

    // Audio tracks / Languages
    hls.on(Events.AUDIO_TRACKS_UPDATED, () => {
      const tracks: AudioTrack[] = hls.audioTracks.map((t, i) => ({
        index: i,
        label: formatAudioLabel(t, i),
        lang: t.lang || '',
      }));
      setAudioTracks(tracks);
    });

    hls.on(Events.AUDIO_TRACK_SWITCHED, () => {
      if (hls.audioTrack >= 0) {
        setCurrentAudioTrack(hls.audioTrack);
      }
    });

    // Buffering
    hls.on(Events.FRAG_BUFFERED, () => setIsBuffering(false));

    // Error recovery
    let recovered = false;
    hls.on(Events.ERROR, (_, data: ErrorData) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !recovered) {
        recovered = true;
        hls.startLoad();
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) {
        recovered = true;
        hls.recoverMediaError();
      } else {
        setError('Playback failed. Please refresh the page.');
        setIsBuffering(false);
      }
    });

    return () => {
      hls.destroy();
      hlsRef.current = null;
    };
  }, [masterManifestUrl]); // Depend ONLY on masterManifestUrl!

  // Data saver mode change
  useEffect(() => {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.autoLevelCapping = dataSaverMode ? 0 : -1;
  }, [dataSaverMode]);

  // ── Video element events ─────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay           = () => setIsPlaying(true);
    const onPause          = () => setIsPlaying(false);
    const onTimeUpdate     = () => setCurrentTime(video.currentTime);
    const onDurationChange = () => setDuration(video.duration);
    const onWaiting        = () => setIsBuffering(true);
    const onPlaying        = () => setIsBuffering(false);
    const onVolumeChange   = () => { setIsMuted(video.muted); setVolume(video.volume); };

    video.addEventListener('play',           onPlay);
    video.addEventListener('pause',          onPause);
    video.addEventListener('timeupdate',     onTimeUpdate);
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('waiting',        onWaiting);
    video.addEventListener('playing',        onPlaying);
    video.addEventListener('volumechange',   onVolumeChange);

    return () => {
      video.removeEventListener('play',           onPlay);
      video.removeEventListener('pause',          onPause);
      video.removeEventListener('timeupdate',     onTimeUpdate);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('waiting',        onWaiting);
      video.removeEventListener('playing',        onPlaying);
      video.removeEventListener('volumechange',   onVolumeChange);
    };
  }, []);

  // Fullscreen change
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // ── Handlers (Async / Await) ───────────────────────────────────────────────
  const handlePlayPause = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (v.paused) {
        await v.play();
      } else {
        v.pause();
      }
    } catch (err) {
      console.warn('[VideoPlayer] Play error:', err);
    }
  }, []);

  const handleFullscreen = useCallback(async () => {
    const c = containerRef.current;
    if (!c) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await c.requestFullscreen();
      }
    } catch (err) {
      console.warn('[VideoPlayer] Fullscreen error:', err);
    }
  }, []);

  // Phone Rotate / Landscape Orientation Handler
  const handleRotateLandscape = useCallback(async () => {
    const c = containerRef.current;
    if (!c) return;
    try {
      if (!document.fullscreenElement) {
        await c.requestFullscreen();
      }
      if (typeof window !== 'undefined' && window.screen?.orientation && 'lock' in window.screen.orientation) {
        await (window.screen.orientation as any).lock('landscape').catch(() => {});
      }
    } catch (err) {
      console.warn('[VideoPlayer] Landscape rotate error:', err);
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (['INPUT','TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
      const video = videoRef.current;
      if (!video) return;
      switch (e.key) {
        case ' ': case 'k': e.preventDefault(); await handlePlayPause(); break;
        case 'ArrowRight':  e.preventDefault(); video.currentTime = Math.min(video.currentTime + 10, video.duration); break;
        case 'ArrowLeft':   e.preventDefault(); video.currentTime = Math.max(video.currentTime - 10, 0); break;
        case 'ArrowUp':     e.preventDefault(); video.volume = Math.min(video.volume + 0.1, 1); break;
        case 'ArrowDown':   e.preventDefault(); video.volume = Math.max(video.volume - 0.1, 0); break;
        case 'm':           video.muted = !video.muted; break;
        case 'f':           await handleFullscreen(); break;
      }
      showControlsNow();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handleFullscreen, handlePlayPause, showControlsNow]);

  const handleMuteToggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
  }, []);

  const handleVolumeChange = useCallback((val: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = val;
    v.muted  = val === 0;
  }, []);

  const handleSeek = useCallback((percent: number) => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    v.currentTime = (percent / 100) * v.duration;
  }, []);

  const handleSelectQuality = useCallback((index: number | 'auto') => {
    const hls = hlsRef.current;
    if (!hls) return;
    if (index === 'auto') {
      hls.currentLevel = -1;
      hls.nextLevel    = -1;
      qualityLockedRef.current = false;
      setCurrentQuality('Auto');
    } else {
      hls.currentLevel = index;
      qualityLockedRef.current = true;
      const level = hls.levels[index];
      if (level) setCurrentQuality(`${level.height}p`);
    }
  }, []);

  const handleAudioTrackChange = useCallback((index: number) => {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.audioTrack = index;
    setCurrentAudioTrack(index);
  }, []);

  const handleSpeedChange = useCallback((speed: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = speed;
    setPlaybackSpeed(speed);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      className="relative w-full bg-black select-none overflow-hidden"
      style={{ aspectRatio: '16/9' }}
      onMouseMove={showControlsNow}
      onMouseLeave={() => isPlaying && setShowControls(false)}
      onTouchStart={showControlsNow}
      onClick={async (e) => {
        // Only toggle play/pause on container click (not on controls)
        if ((e.target as HTMLElement).closest('[data-controls]')) return;
        await handlePlayPause();
        showControlsNow();
      }}
    >
      {/* Video element */}
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        poster={poster}
        playsInline
        preload="metadata"
      />

      {/* Buffering spinner */}
      {isBuffering && !error && <BufferingSpinner />}

      {/* Error overlay */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20 p-4">
          <div className="text-center max-w-sm">
            <div className="text-4xl mb-3">⚠️</div>
            <p className="text-white text-sm font-medium">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-5 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 transition-colors"
            >
              Reload
            </button>
          </div>
        </div>
      )}

      {/* Controls overlay */}
      {!error && (
        <div
          data-controls
          className={`absolute inset-0 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        >
          <Controls
            videoRef={videoRef}
            isPlaying={isPlaying}
            isMuted={isMuted}
            isFullscreen={isFullscreen}
            currentTime={currentTime}
            duration={duration}
            volume={volume}
            currentQuality={currentQuality}
            availableQualities={availableQualities}
            audioTracks={audioTracks}
            currentAudioTrack={currentAudioTrack}
            playbackSpeed={playbackSpeed}
            speedOptions={SPEED_OPTIONS}
            onPlayPause={handlePlayPause}
            onMuteToggle={handleMuteToggle}
            onVolumeChange={handleVolumeChange}
            onSeek={handleSeek}
            onFullscreen={handleFullscreen}
            onRotateLandscape={handleRotateLandscape}
            onSelectQuality={handleSelectQuality}
            onAudioTrackChange={handleAudioTrackChange}
            onSpeedChange={handleSpeedChange}
          />
        </div>
      )}
    </div>
  );
}
