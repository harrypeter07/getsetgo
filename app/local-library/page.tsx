'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface LocalVideoItem {
  name: string;
  size: number;
  file?: File;
  objectUrl: string;
  thumbnailUrl?: string;
}

interface ServerStatus {
  connected: boolean;
  status: string;
  port: number;
  targetFolder: string;
  videoCount: number;
  publicBaseUrl: string;
  uptimeSeconds: number;
  latencyMs: number;
}

export default function LocalLibraryPage() {
  const [videos, setVideos] = useState<LocalVideoItem[]>([]);
  const [activeVideo, setActiveVideo] = useState<LocalVideoItem | null>(null);
  const [folderName, setFolderName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Poll Server Status via Vercel API bridge (No local network permission prompts)
  useEffect(() => {
    async function checkStatus() {
      const pingStart = Date.now();
      try {
        const res = await fetch('/api/local-server-status');
        if (res.ok) {
          const data = await res.json();
          if (data && data.connected) {
            const latencyMs = Date.now() - pingStart;
            setServerStatus({
              ...data,
              connected: true,
              latencyMs,
            });
            return;
          }
        }
        setServerStatus(prev => prev ? { ...prev, connected: false } : null);
      } catch {
        setServerStatus(prev => prev ? { ...prev, connected: false } : null);
      }
    }

    checkStatus();
    const interval = setInterval(checkStatus, 4000);
    return () => clearInterval(interval);
  }, []);

  // Load laptop videos via Vercel API status bridge
  useEffect(() => {
    async function loadLaptopVideos() {
      try {
        setIsLoading(true);
        const statusRes = await fetch('/api/local-server-status');
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          if (statusData.connected && Array.isArray(statusData.videos) && statusData.videos.length > 0) {
            setFolderName(statusData.targetFolder || 'C:\\ShimpliVideos');
            setVideos(statusData.videos);
            console.log(`[Local Library] Loaded ${statusData.videos.length} laptop videos via API bridge!`);
          } else {
            console.log('[Local Library] Laptop server offline or no videos reported.');
          }
        }
      } catch (err) {
        console.error('[Local Library Error]:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadLaptopVideos();
  }, []);

  const handlePickDirectory = async () => {
    try {
      setIsLoading(true);
      setError(null);

      if (!('showDirectoryPicker' in window)) {
        throw new Error('Directory Picker API is supported in Chrome, Edge, Brave, and modern browsers.');
      }

      // @ts-ignore
      const dirHandle = await window.showDirectoryPicker();
      setFolderName(dirHandle.name);

      const items: LocalVideoItem[] = [];
      const SUPPORTED_EXTS = ['.mp4', '.mkv', '.webm', '.mov', '.avi'];

      // @ts-ignore
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
          const file = await entry.getFile();
          const ext = '.' + file.name.split('.').pop()?.toLowerCase();
          if (SUPPORTED_EXTS.includes(ext)) {
            const objectUrl = URL.createObjectURL(file);
            items.push({
              name: file.name,
              size: file.size,
              file,
              objectUrl,
            });
          }
        }
      }

      setVideos(items);
      setActiveVideo(null);
      if (items.length === 0) {
        setError(`No supported video files (.mp4, .webm, .mkv, .mov) found in "${dirHandle.name}".`);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Failed to read local folder.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-text-primary p-4 md:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6 border-b border-white/10 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/" className="text-accent hover:underline text-xs font-bold uppercase tracking-wider">
              ← Back to Home
            </Link>
            <span className="text-white/30">•</span>
            <span className={`text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full border ${
              serverStatus?.connected
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
            }`}>
              {serverStatus?.connected ? '🟢 Laptop Media Server CONNECTED' : '🔴 Server Offline (Click to Pick Folder)'}
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-white mt-2">
            💻 Laptop Media Server Dashboard
          </h1>
          <p className="text-text-secondary text-sm mt-1">
            Videos stream directly from your laptop hard drive with 0 upload wait & zero cloud storage costs!
          </p>
        </div>

        <button
          onClick={handlePickDirectory}
          disabled={isLoading}
          className="
            px-6 py-3.5 bg-gradient-to-r from-accent to-[#B81D24] hover:from-accent-hover hover:to-accent
            text-white font-bold text-sm rounded-2xl shadow-glow-red transition-all
            flex items-center gap-2 border border-white/10 shrink-0
          "
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/>
          </svg>
          {folderName ? `📁 ${folderName}` : '📁 Pick Laptop Folder'}
        </button>
      </div>

      {/* Clean Server Telemetry Status Banner */}
      {serverStatus && (
        <div className="mb-8 bg-surface-alt/90 border border-emerald-500/30 rounded-2xl p-4 shadow-xl flex flex-wrap items-center justify-between gap-4 font-mono text-xs text-white">
          <div className="flex items-center gap-3">
            <span className={`w-3 h-3 rounded-full ${serverStatus.connected ? 'bg-emerald-500 animate-ping' : 'bg-danger'}`} />
            <div>
              <span className="font-bold text-white">Laptop Server: </span>
              <span className={serverStatus.connected ? 'text-emerald-400 font-extrabold' : 'text-danger font-extrabold'}>
                {serverStatus.connected ? 'ACTIVE & ONLINE' : 'DISCONNECTED'}
              </span>
              <span className="text-white/40 ml-2">({serverStatus.targetFolder})</span>
            </div>
          </div>

          <div className="flex items-center gap-6 text-white/70">
            <div>
              <span>Latency: </span>
              <span className="text-emerald-400 font-bold">{serverStatus.latencyMs} ms</span>
            </div>
            <div>
              <span>Files Indexed: </span>
              <span className="text-white font-bold">{serverStatus.videoCount} Videos</span>
            </div>
          </div>
        </div>
      )}

      {/* Active Video Player Screen (Only displayed when user clicks a video card) */}
      {activeVideo && (
        <div className="mb-10 bg-surface border border-accent/40 rounded-3xl overflow-hidden shadow-2xl animate-fade-in">
          <div className="p-4 bg-surface-alt/80 flex items-center justify-between border-b border-white/10">
            <div className="flex items-center gap-2">
              <span className="text-accent font-bold text-sm">▶️ Playing:</span>
              <span className="text-white font-bold text-sm truncate max-w-lg">{activeVideo.name}</span>
            </div>
            <button
              onClick={() => setActiveVideo(null)}
              className="px-3 py-1 bg-white/10 hover:bg-danger text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1"
            >
              <span>✕ Close Player</span>
            </button>
          </div>

          <div className="aspect-video bg-black relative">
            <video
              key={activeVideo.objectUrl}
              src={activeVideo.objectUrl}
              poster={activeVideo.thumbnailUrl}
              controls
              autoPlay
              className="w-full h-full object-contain"
            />
          </div>

          <div className="p-4 flex items-center justify-between bg-surface-alt/60">
            <p className="text-text-secondary text-xs font-mono">
              {activeVideo.size ? `${(activeVideo.size / (1024 * 1024)).toFixed(1)} MB • ` : ''}Laptop Direct Stream (1.5MB Tight Adaptive Chunks)
            </p>
            <span className="text-emerald-400 text-xs font-bold font-mono bg-emerald-500/10 px-3 py-1 rounded-xl border border-emerald-500/20">
              ⚡ 0 ms Latency Direct Stream
            </span>
          </div>
        </div>
      )}

      {/* Error / Instructions */}
      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-2xl p-4 mb-6 text-danger text-sm flex items-center gap-2">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 shrink-0"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
          {error}
        </div>
      )}

      {/* Video Grid */}
      {videos.length > 0 ? (
        <div>
          <h3 className="text-white font-bold text-base mb-4 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span>📁 Videos in Folder:</span>
              <span className="text-accent font-mono text-sm font-extrabold">{videos.length} Files</span>
            </span>
            <span className="text-xs text-white/50 font-normal">Click any card below to play</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {videos.map((item, idx) => {
              const isSelected = activeVideo?.name === item.name;
              return (
                <div
                  key={idx}
                  onClick={() => setActiveVideo(item)}
                  className={`
                    group p-3 rounded-2xl border cursor-pointer transition-all duration-300 flex flex-col justify-between
                    ${isSelected
                      ? 'bg-accent/15 border-accent shadow-glow-red scale-[1.02]'
                      : 'bg-surface border-white/10 hover:border-white/30 hover:bg-surface-alt'
                    }
                  `}
                >
                  {/* Cover Picture / Thumbnail Preview */}
                  <div className="relative aspect-video rounded-xl overflow-hidden bg-black/60 border border-white/10 mb-3 group-hover:border-accent/50 transition-colors">
                    {item.thumbnailUrl ? (
                      <img
                        src={item.thumbnailUrl}
                        alt={item.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-white/5 text-white/40">
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8"><path d="M8 5v14l11-7z"/></svg>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div className="w-10 h-10 rounded-full bg-accent text-white flex items-center justify-center shadow-glow-red scale-90 group-hover:scale-100 transition-transform">
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 ml-0.5"><path d="M8 5v14l11-7z"/></svg>
                      </div>
                    </div>
                  </div>

                  <div className="px-1">
                    <h4 className="text-white font-bold text-sm truncate">{item.name}</h4>
                    <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between text-[11px] text-white/50">
                      <span>{isSelected ? '▶️ Currently Playing' : (item.size ? `${(item.size / (1024 * 1024)).toFixed(1)} MB` : 'Stream')}</span>
                      <span className="font-mono text-emerald-400 font-bold">Click to Play</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        !isLoading && (
          <div className="text-center py-16 bg-surface border border-white/10 rounded-3xl p-8">
            <div className="w-16 h-16 rounded-2xl bg-surface-alt border border-white/10 mx-auto flex items-center justify-center mb-4">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-accent">
                <path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/>
              </svg>
            </div>
            <h3 className="text-white font-bold text-lg">No Videos Found</h3>
            <p className="text-text-secondary text-sm max-w-md mx-auto mt-1">
              Drop any video file into <code>C:\ShimpliVideos</code> on your laptop!
            </p>
          </div>
        )
      )}
    </div>
  );
}
