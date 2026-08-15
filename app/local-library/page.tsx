'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';

// ─── Types ──────────────────────────────────────────────────────────────────
interface VideoItem {
  name        : string;
  size        : number;
  objectUrl   : string;
  thumbnailUrl?: string;
}

interface ServerStatus {
  connected         : boolean;
  status            : string;
  targetFolder      : string;
  videoCount        : number;
  publicBaseUrl     : string;
  latencyMs         : number;
  lastSeenSecondsAgo: number;
}

interface VideoState {
  item     : VideoItem;
  playing  : boolean;
  error    : string | null;
  loaded   : boolean;
}

// ─── Helper ─────────────────────────────────────────────────────────────────
function fmtSize(bytes: number) {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function LocalLibraryPage() {
  const [videos, setVideos]             = useState<VideoItem[]>([]);
  const [videoState, setVideoState]     = useState<VideoState | null>(null);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [isLoading, setIsLoading]       = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [localVideos, setLocalVideos]   = useState<VideoItem[]>([]); // from picked folder
  const videoRef                        = useRef<HTMLVideoElement>(null);

  // ── Status poll via Vercel API bridge (no direct localhost calls) ────────
  useEffect(() => {
    let mounted = true;

    async function poll() {
      const t0 = Date.now();
      try {
        const res  = await fetch('/api/local-server-status', { cache: 'no-store' });
        const data = await res.json();
        if (!mounted) return;
        const latencyMs = Date.now() - t0;

        if (data.connected) {
          setServerStatus({ ...data, latencyMs });
          // Merge server videos with any locally picked folder videos
          const serverList: VideoItem[] = (data.videos || []);
          setVideos(prev => {
            // keep localVideos separate, don't overwrite picked folder
            if (localVideos.length > 0) return [...localVideos, ...serverList];
            return serverList;
          });
        } else {
          setServerStatus(s => s ? { ...s, connected: false, latencyMs } : null);
        }
      } catch {
        if (mounted) setServerStatus(s => s ? { ...s, connected: false } : null);
      }
    }

    poll().finally(() => mounted && setIsLoading(false));
    const iv = setInterval(poll, 5000);
    return () => { mounted = false; clearInterval(iv); };
  }, [localVideos]);

  // ── Pick folder from laptop (Desktop Chrome/Edge) ────────────────────────
  const handlePickFolder = useCallback(async () => {
    try {
      if (!('showDirectoryPicker' in window)) {
        setError('Folder picker requires Chrome / Edge on desktop. On mobile, use the server-connected videos above.');
        return;
      }
      // @ts-ignore
      const dirHandle = await window.showDirectoryPicker();
      const items: VideoItem[] = [];
      const EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi']);
      // @ts-ignore
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
          const file = await entry.getFile();
          const ext  = '.' + file.name.split('.').pop()!.toLowerCase();
          if (EXTS.has(ext)) {
            items.push({ name: file.name, size: file.size, objectUrl: URL.createObjectURL(file) });
          }
        }
      }
      setLocalVideos(items);
      if (items.length === 0) setError(`No video files found in "${dirHandle.name}"`);
    } catch (e: any) {
      if (e.name !== 'AbortError') setError(e.message);
    }
  }, []);

  // ── Play video ────────────────────────────────────────────────────────────
  const playVideo = useCallback((item: VideoItem) => {
    setVideoState({ item, playing: false, error: null, loaded: false });
    // Scroll player into view
    setTimeout(() => document.getElementById('video-player')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }, []);

  const closePlayer = useCallback(() => {
    if (videoRef.current) videoRef.current.pause();
    setVideoState(null);
  }, []);

  const allVideos = [...localVideos, ...videos.filter(v => !localVideos.some(l => l.name === v.name))];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background text-text-primary pb-16">

      {/* ── HEADER ─────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-white/10 px-4 md:px-8 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-accent hover:underline text-xs font-bold uppercase tracking-wider">
            ← Home
          </Link>
          <span className="text-white/20">|</span>
          <span className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded-full border transition-colors ${
            serverStatus?.connected
              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 animate-pulse'
              : 'bg-red-500/15 text-red-400 border-red-500/30'
          }`}>
            {serverStatus?.connected ? '🟢 Laptop Server ONLINE' : '🔴 Server Offline'}
          </span>
        </div>

        <button
          onClick={handlePickFolder}
          className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-xl transition-all flex items-center gap-2 border border-white/10"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/></svg>
          Pick Local Folder
        </button>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-8 pt-6">

        {/* ── PAGE TITLE ─────────────────────────────────────────── */}
        <div className="mb-6">
          <h1 className="text-2xl md:text-3xl font-extrabold text-white">💻 Laptop Media Server</h1>
          <p className="text-text-secondary text-sm mt-1">Stream videos directly from your laptop — zero cloud storage costs</p>
        </div>

        {/* ── SERVER STATUS BANNER ───────────────────────────────── */}
        {serverStatus && (
          <div className={`mb-6 rounded-2xl border p-4 transition-colors ${
            serverStatus.connected
              ? 'bg-emerald-500/8 border-emerald-500/25'
              : 'bg-red-500/8 border-red-500/25'
          }`}>
            <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-xs">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${serverStatus.connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
                <span className="text-white font-bold">
                  {serverStatus.connected ? 'ACTIVE & STREAMING' : 'DISCONNECTED'}
                </span>
                {serverStatus.targetFolder && (
                  <span className="text-white/40 hidden md:inline">({serverStatus.targetFolder})</span>
                )}
              </div>
              {serverStatus.connected && (
                <div className="flex flex-wrap items-center gap-4 text-white/60">
                  <span>Latency: <span className="text-emerald-400 font-bold">{serverStatus.latencyMs}ms</span></span>
                  <span>Files: <span className="text-white font-bold">{serverStatus.videoCount}</span></span>
                  <span>Heartbeat: <span className="text-white/80">{serverStatus.lastSeenSecondsAgo}s ago</span></span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── ERROR ──────────────────────────────────────────────── */}
        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-2xl p-4 text-red-400 text-sm flex items-start gap-2">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 shrink-0 mt-0.5"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-white/40 hover:text-white">✕</button>
          </div>
        )}

        {/* ── VIDEO PLAYER ───────────────────────────────────────── */}
        {videoState && (
          <div id="video-player" className="mb-8 bg-black rounded-3xl overflow-hidden border border-white/10 shadow-2xl">
            {/* Player header */}
            <div className="px-4 py-3 bg-[#111] flex items-center justify-between border-b border-white/10">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-red-500 font-bold text-xs shrink-0">▶ NOW PLAYING</span>
                <span className="text-white text-sm font-bold truncate">{videoState.item.name}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {videoState.item.size > 0 && (
                  <span className="text-white/40 text-xs font-mono">{fmtSize(videoState.item.size)}</span>
                )}
                <button
                  onClick={closePlayer}
                  className="px-3 py-1 bg-white/10 hover:bg-red-500/80 text-white text-xs font-bold rounded-lg transition-colors"
                >✕ Close</button>
              </div>
            </div>

            {/* Video element */}
            <div className="aspect-video bg-black relative">
              {videoState.error ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-red-400 p-6">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-12 h-12 opacity-60"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
                  <p className="font-bold text-center">{videoState.error}</p>
                  <p className="text-white/40 text-xs text-center max-w-sm">
                    Make sure the laptop server is running and the Cloudflare tunnel is active.
                    MKV files may not be supported on all devices — try converting to MP4.
                  </p>
                  <button
                    onClick={() => setVideoState(s => s ? { ...s, error: null } : null)}
                    className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-white text-sm font-bold"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <video
                  ref={videoRef}
                  key={videoState.item.objectUrl}
                  src={videoState.item.objectUrl}
                  poster={videoState.item.thumbnailUrl}
                  controls
                  autoPlay
                  playsInline
                  preload="auto"
                  crossOrigin="anonymous"
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    const vid = e.currentTarget;
                    const errCode = vid.error?.code;
                    const errMap: Record<number, string> = {
                      1: 'Playback aborted by user',
                      2: 'Network error — check your connection',
                      3: 'Video decoding error — file may be corrupted or unsupported format',
                      4: 'Video format not supported by this browser (MKV/AVI may not play on mobile)',
                    };
                    setVideoState(s => s ? { ...s, error: errMap[errCode ?? 0] || 'Unknown playback error' } : null);
                  }}
                  onCanPlay={() => setVideoState(s => s ? { ...s, loaded: true } : null)}
                  onPlay={()   => setVideoState(s => s ? { ...s, playing: true } : null)}
                  onPause={()  => setVideoState(s => s ? { ...s, playing: false } : null)}
                />
              )}
            </div>

            {/* Player footer */}
            <div className="px-4 py-3 bg-[#0d0d0d] flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-white/50">
              <span>
                {videoState.item.objectUrl.includes('trycloudflare.com') ? '☁️ Cloudflare CDN Stream' : '📁 Local File'}
                {' — '}True HTTP Range Streaming (browser controls chunk size)
              </span>
              <span className={`px-2 py-0.5 rounded-md border ${
                videoState.loaded ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
              }`}>
                {videoState.error ? '❌ Error' : videoState.playing ? '▶ Playing' : videoState.loaded ? '⏸ Paused' : '⏳ Loading…'}
              </span>
            </div>
          </div>
        )}

        {/* ── LOADING STATE ──────────────────────────────────────── */}
        {isLoading && (
          <div className="text-center py-12 text-white/50">
            <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm">Connecting to laptop server…</p>
          </div>
        )}

        {/* ── VIDEO GRID ─────────────────────────────────────────── */}
        {!isLoading && allVideos.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-bold text-base flex items-center gap-2">
                📁 Videos
                <span className="text-accent font-mono text-sm">{allVideos.length} files</span>
              </h2>
              <span className="text-xs text-white/40">Click to play</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {allVideos.map((item, idx) => {
                const isActive = videoState?.item.name === item.name;
                const isLocal  = localVideos.some(l => l.name === item.name);
                return (
                  <div
                    key={idx}
                    onClick={() => playVideo(item)}
                    className={`group rounded-2xl border cursor-pointer transition-all duration-200 overflow-hidden flex flex-col ${
                      isActive
                        ? 'border-accent bg-accent/10 shadow-lg shadow-accent/10 scale-[1.01]'
                        : 'border-white/10 bg-[#111] hover:border-white/25 hover:bg-[#1a1a1a]'
                    }`}
                  >
                    {/* Thumbnail */}
                    <div className="relative aspect-video bg-black overflow-hidden">
                      {item.thumbnailUrl ? (
                        <img
                          src={item.thumbnailUrl}
                          alt={item.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white/20">
                          <svg viewBox="0 0 24 24" fill="currentColor" className="w-10 h-10"><path d="M8 5v14l11-7z"/></svg>
                        </div>
                      )}
                      {/* Play button overlay */}
                      <div className={`absolute inset-0 flex items-center justify-center transition-opacity ${
                        isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}>
                        <div className="w-12 h-12 rounded-full bg-red-600 flex items-center justify-center shadow-xl">
                          <svg viewBox="0 0 24 24" fill="white" className="w-6 h-6 ml-1"><path d="M8 5v14l11-7z"/></svg>
                        </div>
                      </div>
                      {/* Source badge */}
                      <div className="absolute top-1.5 right-1.5">
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-black/70 text-white/60">
                          {isLocal ? '📁 LOCAL' : '☁️ STREAM'}
                        </span>
                      </div>
                    </div>

                    {/* Info */}
                    <div className="p-3">
                      <p className="text-white text-xs font-bold truncate leading-snug" title={item.name}>{item.name}</p>
                      <div className="mt-2 flex items-center justify-between text-[10px] text-white/40">
                        <span>{item.size ? fmtSize(item.size) : '—'}</span>
                        <span className={isActive ? 'text-accent font-bold' : 'text-emerald-500'}>
                          {isActive ? (videoState?.playing ? '▶ Playing' : '⏸ Paused') : '▶ Play'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── EMPTY STATE ────────────────────────────────────────── */}
        {!isLoading && allVideos.length === 0 && (
          <div className="text-center py-16 bg-[#0d0d0d] rounded-3xl border border-white/8">
            <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-accent"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/></svg>
            </div>
            <h3 className="text-white font-bold text-lg mb-2">No Videos Found</h3>
            <p className="text-white/40 text-sm max-w-sm mx-auto mb-6">
              {serverStatus?.connected
                ? `Server is online but no videos in ${serverStatus.targetFolder || 'C:\\ShimpliVideos'}`
                : 'Start the laptop server: node scripts/local-server.js "C:\\ShimpliVideos"'}
            </p>
            <button
              onClick={handlePickFolder}
              className="px-6 py-3 bg-accent hover:bg-accent/80 text-white font-bold rounded-2xl transition-colors text-sm"
            >
              📁 Pick a Local Folder
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
