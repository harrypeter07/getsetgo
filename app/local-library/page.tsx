'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';

// ─── Types ──────────────────────────────────────────────────────────────────
interface VideoItem {
  name        : string;
  size        : number;
  hlsUrl      : string;    // HLS init URL → redirects to m3u8
  streamUrl   : string;    // fallback direct stream
  objectUrl   : string;    // alias for compatibility
  thumbnailUrl?: string;
}

interface ServerStatus {
  connected         : boolean;
  targetFolder      : string;
  videoCount        : number;
  publicBaseUrl     : string;
  latencyMs         : number;
  lastSeenSecondsAgo: number;
}

interface PlayerState {
  item    : VideoItem;
  status  : 'loading' | 'playing' | 'paused' | 'buffering' | 'error';
  errorMsg: string | null;
  quality : string;
}

function fmtSize(b: number) {
  if (!b) return '—';
  if (b < 1048576)    return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}

// ─── HLS Player Component ────────────────────────────────────────────────────
function HLSPlayer({ item, onClose }: { item: VideoItem; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef   = useRef<any>(null);
  const [status,  setStatus]  = useState<'loading'|'playing'|'paused'|'buffering'|'error'>('loading');
  const [errMsg,  setErrMsg]  = useState<string | null>(null);
  const [hlsMode, setHlsMode] = useState<'hls.js' | 'native' | 'direct' | null>(null);
  const [bufPct,  setBufPct]  = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const hlsUrl    = item.hlsUrl || item.objectUrl;
    const streamUrl = item.streamUrl || item.objectUrl;

    // Determine best playback method
    async function init() {
      try {
        // 1. Try HLS.js (Chrome/Firefox/Android)
        const Hls = (await import('hls.js')).default;

        if (Hls.isSupported()) {
          setHlsMode('hls.js');
          const hls = new Hls({
            // Buffer config — aggressive pre-buffering for remote streams
            maxBufferLength            : 60,    // buffer up to 60s ahead
            maxMaxBufferLength         : 120,   // max buffer cap
            enableWorker               : true,
            lowLatencyMode             : false,
            backBufferLength           : 10,
            // Loader / retry config
            fragLoadingMaxRetry        : 6,
            fragLoadingRetryDelay      : 500,
            fragLoadingMaxRetryTimeout : 8_000,
            manifestLoadingMaxRetry    : 4,
            manifestLoadingRetryDelay  : 1_000,
            // Small starting fragment to get first frame fast
            startFragPrefetch          : true,
            xhrSetup(xhr: XMLHttpRequest) {
              xhr.setRequestHeader('bypass-tunnel-reminder', 'true');
            },
          });

          hlsRef.current = hls;

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            setStatus('loading');
            video.play().catch(() => {});
          });

          hls.on(Hls.Events.FRAG_BUFFERED, (_e: any, data: any) => {
            if (data?.frag) {
              const buffered = video.buffered;
              if (buffered.length > 0) {
                const pct = Math.min(100, (buffered.end(buffered.length - 1) / (video.duration || 1)) * 100);
                setBufPct(Math.round(pct));
              }
            }
          });

          hls.on(Hls.Events.ERROR, (_e: any, data: any) => {
            if (data.fatal) {
              if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                hls.startLoad(); // retry
              } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                hls.recoverMediaError();
              } else {
                // Fatal: fallback to direct stream
                hls.destroy();
                setHlsMode('direct');
                setErrMsg('HLS error — falling back to direct stream');
                video.src = streamUrl;
                video.play().catch(() => {});
              }
            }
          });

          hls.loadSource(hlsUrl);
          hls.attachMedia(video);
          return;
        }

        // 2. Native HLS (Safari / iOS)
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          setHlsMode('native');
          video.src = hlsUrl;
          video.play().catch(() => {});
          return;
        }

        // 3. Direct Range Stream fallback
        setHlsMode('direct');
        video.src = streamUrl;
        video.play().catch(() => {});

      } catch (e: any) {
        // If hls.js import fails, go direct
        setHlsMode('direct');
        video.src = streamUrl;
      }
    }

    init();

    return () => {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      video.pause();
      video.src = '';
    };
  }, [item.hlsUrl, item.streamUrl, item.objectUrl]);

  return (
    <div className="mb-8 bg-black rounded-3xl overflow-hidden border border-white/10 shadow-2xl" id="video-player">
      {/* Header */}
      <div className="px-4 py-3 bg-[#111] flex items-center justify-between border-b border-white/10">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-red-500 font-bold text-xs shrink-0">▶ NOW PLAYING</span>
          <span className="text-white text-sm font-bold truncate">{item.name}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {item.size > 0 && (
            <span className="text-white/40 text-xs font-mono hidden sm:block">{fmtSize(item.size)}</span>
          )}
          {hlsMode && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/20">
              {hlsMode === 'hls.js' ? '⚡ HLS.js' : hlsMode === 'native' ? '🍎 Native HLS' : '📡 Direct'}
            </span>
          )}
          <button onClick={onClose} className="px-3 py-1 bg-white/10 hover:bg-red-600 text-white text-xs font-bold rounded-lg transition-colors">
            ✕ Close
          </button>
        </div>
      </div>

      {/* Video */}
      <div className="aspect-video bg-black relative">
        {/* Loading overlay */}
        {status === 'loading' && !errMsg && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 bg-black/60">
            <div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-white/70 text-sm">Preparing HLS stream…</p>
            <p className="text-white/40 text-xs">ffmpeg is segmenting your video</p>
          </div>
        )}

        {/* Error overlay */}
        {errMsg && status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 p-6 text-center">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-12 h-12 text-red-500/60"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
            <p className="text-red-400 font-bold">{errMsg}</p>
          </div>
        )}

        <video
          ref={videoRef}
          controls
          playsInline
          preload="auto"
          crossOrigin="anonymous"
          className="w-full h-full object-contain"
          onPlay={()    => setStatus('playing')}
          onPause={()   => setStatus('paused')}
          onWaiting={()  => setStatus('buffering')}
          onPlaying={()  => setStatus('playing')}
          onCanPlay={()  => setStatus(s => s === 'loading' ? 'playing' : s)}
          onError={(e) => {
            const code = e.currentTarget.error?.code;
            const msgs: Record<number, string> = {
              1: 'Playback aborted',
              2: 'Network error — check connection and tunnel',
              3: 'Decoding error — file may be corrupted',
              4: 'Format not supported (MKV/AVI may not play on mobile — server will re-encode)',
            };
            setErrMsg(msgs[code ?? 0] || `Error code ${code}`);
            setStatus('error');
          }}
        />
      </div>

      {/* Footer stats */}
      <div className="px-4 py-2.5 bg-[#0d0d0d] flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-white/40">
        <div className="flex items-center gap-3">
          <span>HLS Adaptive Segments • 4s chunks • auto-retry</span>
          {bufPct > 0 && <span className="text-emerald-500">Buffered: {bufPct}%</span>}
        </div>
        <span className={`px-2 py-0.5 rounded border font-bold ${
          status === 'playing'   ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
          status === 'buffering' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' :
          status === 'error'     ? 'bg-red-500/10 text-red-400 border-red-500/20' :
          'bg-white/5 text-white/40 border-white/10'
        }`}>
          {status === 'playing' ? '▶ Playing' : status === 'buffering' ? '⏳ Buffering…' :
           status === 'paused'  ? '⏸ Paused'  : status === 'error' ? '❌ Error' : '⏳ Loading…'}
        </span>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function LocalLibraryPage() {
  const [videos,      setVideos]      = useState<VideoItem[]>([]);
  const [activeItem,  setActiveItem]  = useState<VideoItem | null>(null);
  const [serverStatus,setServerStatus]= useState<ServerStatus | null>(null);
  const [localVideos, setLocalVideos] = useState<VideoItem[]>([]);
  const [isLoading,   setIsLoading]   = useState(true);
  const [error,       setError]       = useState<string | null>(null);

  // ── Server status poll ──────────────────────────────────────────
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
          const serverList: VideoItem[] = (data.videos || []).map((v: any) => ({
            name        : v.name,
            size        : v.size || 0,
            hlsUrl      : v.hlsUrl || v.objectUrl,
            streamUrl   : v.streamUrl || v.objectUrl,
            objectUrl   : v.objectUrl,
            thumbnailUrl: v.thumbnailUrl,
          }));
          setVideos(serverList);
        } else {
          setServerStatus(s => s ? { ...s, connected: false, latencyMs } : null);
        }
      } catch {
        if (mounted) setServerStatus(s => s ? { ...s, connected: false } : null);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    poll();
    const iv = setInterval(poll, 6000);
    return () => { mounted = false; clearInterval(iv); };
  }, []);

  // ── Pick local folder ──────────────────────────────────────────
  const pickFolder = useCallback(async () => {
    try {
      if (!('showDirectoryPicker' in window)) {
        setError('Folder picker requires Chrome/Edge desktop. On mobile, use server-connected videos.');
        return;
      }
      // @ts-ignore
      const dir   = await window.showDirectoryPicker();
      const items: VideoItem[] = [];
      const EXTS  = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi']);
      // @ts-ignore
      for await (const entry of dir.values()) {
        if (entry.kind === 'file') {
          const file = await entry.getFile();
          const ext  = '.' + file.name.split('.').pop()!.toLowerCase();
          if (EXTS.has(ext)) {
            const url = URL.createObjectURL(file);
            items.push({ name: file.name, size: file.size, hlsUrl: url, streamUrl: url, objectUrl: url });
          }
        }
      }
      setLocalVideos(items);
    } catch (e: any) {
      if (e.name !== 'AbortError') setError(e.message);
    }
  }, []);

  const playVideo = useCallback((item: VideoItem) => {
    setActiveItem(item);
    setTimeout(() => document.getElementById('video-player')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }, []);

  const allVideos = [...localVideos, ...videos.filter(v => !localVideos.some(l => l.name === v.name))];

  return (
    <div className="min-h-screen bg-background text-text-primary pb-16">

      {/* ── Sticky header ───────────────────────────────────────── */}
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-white/10 px-4 md:px-8 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-accent hover:underline text-xs font-bold uppercase tracking-wider">← Home</Link>
          <span className="text-white/20">|</span>
          <span className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded-full border ${
            serverStatus?.connected
              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
              : 'bg-red-500/15 text-red-400 border-red-500/30'
          }`}>
            {serverStatus?.connected ? '🟢 ONLINE' : '🔴 Offline'}
          </span>
        </div>
        <button onClick={pickFolder}
          className="px-4 py-2 bg-white/8 hover:bg-white/15 text-white text-xs font-bold rounded-xl transition-all flex items-center gap-2 border border-white/10">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/></svg>
          Pick Local Folder
        </button>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-8 pt-6">
        {/* Title */}
        <div className="mb-6">
          <h1 className="text-2xl md:text-3xl font-extrabold text-white">💻 Laptop Media Server</h1>
          <p className="text-white/40 text-sm mt-1">HLS adaptive streaming · 4-second segments · works on any connection</p>
        </div>

        {/* Server status bar */}
        {serverStatus && (
          <div className={`mb-6 rounded-2xl border p-4 font-mono text-xs ${
            serverStatus.connected ? 'bg-emerald-500/8 border-emerald-500/25' : 'bg-red-500/8 border-red-500/25'
          }`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${serverStatus.connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
                <span className="text-white font-bold">{serverStatus.connected ? 'ACTIVE & STREAMING' : 'DISCONNECTED'}</span>
                <span className="text-white/30 hidden md:inline">({serverStatus.targetFolder})</span>
              </div>
              {serverStatus.connected && (
                <div className="flex flex-wrap gap-4 text-white/50">
                  <span>Latency: <b className="text-emerald-400">{serverStatus.latencyMs}ms</b></span>
                  <span>Files: <b className="text-white">{serverStatus.videoCount}</b></span>
                  <span>Heartbeat: <b className="text-white/70">{serverStatus.lastSeenSecondsAgo}s ago</b></span>
                  <span className="text-blue-400 font-bold">⚡ HLS Mode</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-2xl p-4 text-red-400 text-sm flex items-start gap-2">
            <span className="shrink-0">⚠️</span>
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-white/30 hover:text-white">✕</button>
          </div>
        )}

        {/* HLS Player */}
        {activeItem && (
          <HLSPlayer item={activeItem} onClose={() => setActiveItem(null)} />
        )}

        {/* Loading */}
        {isLoading && (
          <div className="text-center py-16 text-white/40">
            <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm">Connecting to laptop server…</p>
          </div>
        )}

        {/* Video Grid */}
        {!isLoading && allVideos.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-bold text-base flex items-center gap-2">
                📁 Videos
                <span className="text-accent font-mono">{allVideos.length} files</span>
              </h2>
              <span className="text-xs text-white/30">Click any card to stream via HLS</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {allVideos.map((item, idx) => {
                const isActive = activeItem?.name === item.name;
                const isLocal  = localVideos.some(l => l.name === item.name);
                return (
                  <div
                    key={idx}
                    onClick={() => playVideo(item)}
                    className={`group rounded-2xl border cursor-pointer transition-all duration-200 overflow-hidden flex flex-col ${
                      isActive
                        ? 'border-accent bg-accent/8 shadow-lg shadow-accent/10 scale-[1.01]'
                        : 'border-white/10 bg-[#111] hover:border-white/25 hover:bg-[#1a1a1a]'
                    }`}
                  >
                    {/* Thumbnail */}
                    <div className="relative aspect-video bg-black overflow-hidden">
                      {item.thumbnailUrl ? (
                        <img src={item.thumbnailUrl} alt={item.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white/15">
                          <svg viewBox="0 0 24 24" fill="currentColor" className="w-10 h-10"><path d="M8 5v14l11-7z"/></svg>
                        </div>
                      )}
                      {/* Play overlay */}
                      <div className={`absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                        <div className="w-12 h-12 rounded-full bg-red-600 shadow-xl flex items-center justify-center">
                          <svg viewBox="0 0 24 24" fill="white" className="w-6 h-6 ml-1"><path d="M8 5v14l11-7z"/></svg>
                        </div>
                      </div>
                      {/* Badge */}
                      <div className="absolute top-1.5 left-1.5">
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-black/70 text-white/60">
                          {isLocal ? '📁 LOCAL' : '⚡ HLS'}
                        </span>
                      </div>
                    </div>

                    {/* Info */}
                    <div className="p-3">
                      <p className="text-white text-xs font-bold truncate" title={item.name}>{item.name}</p>
                      <div className="mt-2 flex items-center justify-between text-[10px] text-white/40">
                        <span>{fmtSize(item.size)}</span>
                        <span className={isActive ? 'text-accent font-bold' : 'text-emerald-500'}>
                          {isActive ? '▶ Playing' : '▶ Play HLS'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && allVideos.length === 0 && (
          <div className="text-center py-16 bg-[#0d0d0d] rounded-3xl border border-white/8">
            <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-accent"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/></svg>
            </div>
            <h3 className="text-white font-bold text-lg mb-2">No Videos Found</h3>
            <p className="text-white/40 text-sm max-w-sm mx-auto mb-4">
              {serverStatus?.connected
                ? `Server online but no videos in ${serverStatus.targetFolder}`
                : 'Run: node scripts/local-server.js "C:\\ShimpliVideos"'}
            </p>
            <button onClick={pickFolder}
              className="px-6 py-3 bg-accent hover:bg-accent/80 text-white font-bold rounded-2xl transition-colors text-sm">
              📁 Pick a Local Folder
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
