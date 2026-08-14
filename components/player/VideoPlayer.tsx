'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import Hls, { type HlsConfig, Events, ErrorData, LevelSwitchedData } from 'hls.js';
import Controls from './Controls';
import BufferingSpinner from './BufferingSpinner';
import QualitySelector from './QualitySelector';

interface VideoPlayerProps {
  masterManifestUrl: string;
  poster?: string;
  onQualityChange?: (level: { label: string; height: number }) => void;
  dataSaverMode?: boolean;
}

interface QualityLevel {
  index: number;
  label: string;
  height: number;
}

export default function VideoPlayer({
  masterManifestUrl,
  poster,
  onQualityChange,
  dataSaverMode = false,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [isBuffering, setIsBuffering] = useState(true); // start true so spinner shows immediately
  const [error, setError] = useState<string | null>(null);
  const [currentQuality, setCurrentQuality] = useState<string>('Auto');
  const [availableQualities, setAvailableQualities] = useState<QualityLevel[]>([]);
  const [qualityLocked, setQualityLocked] = useState(false);
  const qualityLockedRef = useRef(false); // ref avoids stale closure in HLS event handlers
  const [showQualitySelector, setShowQualitySelector] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Determine initial quality index hint from network type
  const getStartLevelHint = useCallback(() => {
    const conn = (navigator as Navigator & { connection?: { effectiveType: string } }).connection;
    if (!conn) return -1;
    switch (conn.effectiveType) {
      case 'slow-2g':
      case '2g':  return 0; // 240p
      case '3g':  return 1; // 360p
      default:    return -1; // let hls.js decide
    }
  }, []);

  const findQuality480pIndex = useCallback((levels: Hls['levels']) => {
    const idx = levels.findIndex((l) => l.height <= 480);
    return idx >= 0 ? idx : levels.length - 1;
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!Hls.isSupported()) {
      // Native HLS (Safari)
      video.src = masterManifestUrl;
      return;
    }

    const hlsConfig: Partial<HlsConfig> = {
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      startLevel: dataSaverMode ? 0 : getStartLevelHint(), // data saver = lowest quality
      abrEwmaDefaultEstimate: 1500000,   // assume 1.5Mbps to start higher quality faster
      capLevelToPlayerSize: true,
      lowLatencyMode: false,
      progressive: true,                  // start playing as soon as first segment loads
    };

    const hls = new Hls(hlsConfig);
    hlsRef.current = hls;

    hls.loadSource(masterManifestUrl);
    hls.attachMedia(video);

    hls.on(Events.MANIFEST_PARSED, (_, data) => {
      const levels = hls.levels;
      const qualities: QualityLevel[] = levels.map((l, i) => ({
        index: i,
        label: `${l.height}p`,
        height: l.height,
      }));
      setAvailableQualities(qualities);

      // Apply data saver mode cap
      if (dataSaverMode) {
        hls.autoLevelCapping = findQuality480pIndex(levels);
      } else {
        hls.autoLevelCapping = -1;
      }

      video.play().catch(() => {});
    });

    hls.on(Events.LEVEL_SWITCHED, (_, data: LevelSwitchedData) => {
      const level = hls.levels[data.level];
      if (level && !qualityLockedRef.current) { // use ref, not state — avoids stale closure
        const label = `${level.height}p`;
        setCurrentQuality(label);
        onQualityChange?.({ label, height: level.height });
      }
    });

    // Buffering state is handled via native video element 'waiting'/'playing' events below
    // FRAG_BUFFERED signals buffer is healthy
    hls.on(Events.FRAG_BUFFERED, () => {
      setIsBuffering(false);
    });

    let recoverAttempted = false;
    hls.on(Events.ERROR, (_, data: ErrorData) => {
      if (data.fatal) {
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if (!recoverAttempted) {
            recoverAttempted = true;
            hls.recoverMediaError();
          } else {
            setError('Connection lost. Please check your internet and refresh.');
            setIsBuffering(false);
          }
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          if (!recoverAttempted) {
            recoverAttempted = true;
            hls.recoverMediaError();
          } else {
            setError('Media error. Please try refreshing the page.');
          }
        } else {
          setError('Playback failed. Please try refreshing the page.');
        }
      }
    });

    return () => {
      hls.destroy();
      hlsRef.current = null;
    };
  }, [masterManifestUrl, dataSaverMode, getStartLevelHint, findQuality480pIndex]);

  // Re-apply data saver cap when prop changes
  useEffect(() => {
    const hls = hlsRef.current;
    if (!hls) return;
    if (dataSaverMode) {
      hls.autoLevelCapping = findQuality480pIndex(hls.levels);
    } else {
      hls.autoLevelCapping = -1;
    }
  }, [dataSaverMode, findQuality480pIndex]);

  const handleSelectQuality = useCallback((index: number | 'auto') => {
    const hls = hlsRef.current;
    if (!hls) return;

    if (index === 'auto') {
      hls.currentLevel = -1;
      hls.nextLevel = -1;
      qualityLockedRef.current = false;
      setQualityLocked(false);
      setCurrentQuality('Auto');
    } else {
      hls.currentLevel = index;
      qualityLockedRef.current = true;
      setQualityLocked(true);
      const level = hls.levels[index];
      if (level) setCurrentQuality(`${level.height}p`);
    }
    setShowQualitySelector(false);
  }, []);

  const handlePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  }, []);

  const handleMuteToggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  }, []);

  const handleVolumeChange = useCallback((v: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = v;
    setVolume(v);
    if (v === 0) {
      video.muted = true;
      setIsMuted(true);
    } else {
      video.muted = false;
      setIsMuted(false);
    }
  }, []);

  const handleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const handleSeek = useCallback((percent: number) => {
    const video = videoRef.current;
    if (!video || !video.duration) return;
    video.currentTime = (percent / 100) * video.duration;
  }, []);

  // Video event listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTimeUpdate = () => setCurrentTime(video.currentTime);
    const onDurationChange = () => setDuration(video.duration);
    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => setIsBuffering(false);

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full bg-black select-none overflow-hidden"
      style={{ aspectRatio: '16/9' }}
      onClick={() => setShowQualitySelector(false)}
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
            <div className="text-danger text-4xl mb-3">⚠️</div>
            <p className="text-text-primary text-sm font-medium">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-accent text-white rounded-lg text-sm font-semibold hover:bg-accent/80 active:scale-95 transition-all"
            >
              Reload page
            </button>
          </div>
        </div>
      )}

      {/* Quality Selector (bottom sheet on mobile, dropdown on desktop) */}
      {showQualitySelector && (
        <QualitySelector
          qualities={availableQualities}
          currentQuality={currentQuality}
          qualityLocked={qualityLocked}
          onSelect={handleSelectQuality}
          onClose={() => setShowQualitySelector(false)}
        />
      )}

      {/* Controls overlay */}
      {!error && (
        <Controls
          videoRef={videoRef}
          isPlaying={isPlaying}
          isMuted={isMuted}
          isFullscreen={isFullscreen}
          currentTime={currentTime}
          duration={duration}
          volume={volume}
          currentQuality={currentQuality}
          onPlayPause={handlePlayPause}
          onMuteToggle={handleMuteToggle}
          onVolumeChange={handleVolumeChange}
          onSeek={handleSeek}
          onFullscreen={handleFullscreen}
          onQualityToggle={() => setShowQualitySelector((v) => !v)}
        />
      )}
    </div>
  );
}
