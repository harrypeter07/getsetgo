'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface LocalVideoItem {
  name: string;
  size: number;
  file?: File;
  objectUrl: string;
}

export default function LocalLibraryPage() {
  const [videos, setVideos] = useState<LocalVideoItem[]>([]);
  const [activeVideo, setActiveVideo] = useState<LocalVideoItem | null>(null);
  const [folderName, setFolderName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isNodeServerActive, setIsNodeServerActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-connect to Laptop Local Node Server (http://localhost:4000) on mount
  useEffect(() => {
    async function checkLocalServer() {
      try {
        setIsLoading(true);
        const res = await fetch('http://localhost:4000/list');
        if (res.ok) {
          const list = await res.json();
          if (Array.isArray(list) && list.length > 0) {
            setIsNodeServerActive(true);
            setFolderName('C:\\ShimpliVideos');
            const items: LocalVideoItem[] = list.map((item: any) => ({
              name: item.fileName || item.title,
              size: item.size || 0,
              objectUrl: `http://localhost:4000/stream?file=${encodeURIComponent(item.filePath)}`,
            }));
            setVideos(items);
            setActiveVideo(items[0]);
            console.log(`[Local Library] Connected to Laptop Server! Loaded ${items.length} videos.`);
          }
        }
      } catch (err) {
        console.log('[Local Library] Standalone mode. Use directory picker or launch node scripts/local-server.js.');
      } finally {
        setIsLoading(false);
      }
    }
    checkLocalServer();
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
      setIsNodeServerActive(false);

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
      if (items.length > 0) {
        setActiveVideo(items[0]);
      } else {
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
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8 border-b border-white/10 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/" className="text-accent hover:underline text-xs font-bold uppercase tracking-wider">
              ← Back to Home
            </Link>
            <span className="text-white/30">•</span>
            <span className="bg-emerald-500/20 text-emerald-400 text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full border border-emerald-500/30">
              {isNodeServerActive ? '🟢 Connected to Laptop Server (C:\\ShimpliVideos)' : '⚡ Instant 0-Upload Local Streaming'}
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-white mt-2">
            💻 Laptop Media Library
          </h1>
          <p className="text-text-secondary text-sm mt-1">
            Videos stream directly from your laptop hard drive with 0 upload wait & zero bandwidth usage!
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
          {folderName ? `📁 Active Folder (${folderName})` : '📁 Select Folder on My Laptop'}
        </button>
      </div>

      {/* Active Video Player Screen */}
      {activeVideo && (
        <div className="mb-10 bg-surface border border-accent/30 rounded-3xl overflow-hidden shadow-2xl animate-fade-in">
          <div className="aspect-video bg-black relative">
            <video
              key={activeVideo.objectUrl}
              src={activeVideo.objectUrl}
              controls
              autoPlay
              className="w-full h-full object-contain"
            />
          </div>
          <div className="p-5 flex items-center justify-between bg-surface-alt/60">
            <div>
              <h2 className="text-lg font-bold text-white truncate max-w-xl">{activeVideo.name}</h2>
              <p className="text-text-secondary text-xs font-mono mt-0.5">
                {(activeVideo.size / (1024 * 1024)).toFixed(1)} MB • Laptop Local SSD Direct Stream
              </p>
            </div>
            <span className="text-emerald-400 text-xs font-bold font-mono bg-emerald-500/10 px-3 py-1.5 rounded-xl border border-emerald-500/20 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              Direct NVMe/SSD Hardware Playback (0 ms latency)
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
          <h3 className="text-white font-bold text-base mb-4 flex items-center gap-2">
            <span>📁 Videos in Folder:</span>
            <span className="text-accent font-mono text-sm font-extrabold">{videos.length} Files</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {videos.map((item, idx) => {
              const isSelected = activeVideo?.name === item.name;
              return (
                <div
                  key={idx}
                  onClick={() => setActiveVideo(item)}
                  className={`
                    p-4 rounded-2xl border cursor-pointer transition-all duration-300 flex flex-col justify-between
                    ${isSelected
                      ? 'bg-accent/10 border-accent shadow-glow-red scale-[1.02]'
                      : 'bg-surface border-white/10 hover:border-white/30 hover:bg-surface-alt'
                    }
                  `}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isSelected ? 'bg-accent text-white' : 'bg-white/5 text-white/50'}`}>
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                        <path d="M8 5v14l11-7z"/>
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-white font-bold text-sm truncate">{item.name}</h4>
                      <p className="text-text-secondary text-xs font-mono mt-1">
                        {(item.size / (1024 * 1024)).toFixed(1)} MB
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-[11px] text-white/50">
                    <span>{isSelected ? '▶️ Now Playing' : 'Click to Stream'}</span>
                    <span className="font-mono text-emerald-400">0 ms latency</span>
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
            <h3 className="text-white font-bold text-lg">No Videos in Folder Yet</h3>
            <p className="text-text-secondary text-sm max-w-md mx-auto mt-1">
              Drop any video file into <code>C:\ShimpliVideos</code> or click the button above to pick a folder!
            </p>
          </div>
        )
      )}
    </div>
  );
}
