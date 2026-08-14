'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { ChangeEvent, DragEvent, FormEvent } from 'react';

interface UploadFormProps {
  onJobCreated: (jobId: string) => void;
}

export default function UploadForm({ onJobCreated }: UploadFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isUltraSpeed, setIsUltraSpeed] = useState<boolean>(true);
  const [savedChunkCount, setSavedChunkCount] = useState<number>(0);

  // Upload progress states
  const [progressPercent, setProgressPercent] = useState(0);
  const [uploadSpeedMbps, setUploadSpeedMbps] = useState(0);
  const [etaSeconds, setEtaSeconds] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelUploadRef = useRef(false);
  const isPausedRef = useRef(false);

  // Check saved progress when file is selected
  useEffect(() => {
    if (!file) { setSavedChunkCount(0); return; }
    const resumeKey = `shimpli_upload_${file.name}_${file.size}`;
    try {
      const saved = localStorage.getItem(resumeKey);
      if (saved) {
        const arr = JSON.parse(saved);
        setSavedChunkCount(arr.length || 0);
      } else {
        setSavedChunkCount(0);
      }
    } catch {
      setSavedChunkCount(0);
    }
  }, [file]);

  const clearSavedProgress = useCallback(() => {
    if (!file) return;
    const resumeKey = `shimpli_upload_${file.name}_${file.size}`;
    try { localStorage.removeItem(resumeKey); } catch {}
    setSavedChunkCount(0);
  }, [file]);

  const handleFileChange = useCallback((f: File | null) => {
    if (!f) return;
    setError(null);
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
  }, [title]);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    handleFileChange(e.target.files?.[0] ?? null);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileChange(e.dataTransfer.files?.[0] ?? null);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  // ── Pause & Cancel Controls ────────────────────────────────────────────────
  const handleTogglePause = () => {
    setIsPaused(prev => {
      const next = !prev;
      isPausedRef.current = next;
      setStatusMessage(next ? '⏸️ Upload Paused (Progress Saved)' : '⚡ Resuming Rapid Upload...');
      return next;
    });
  };

  const handleCancelUpload = () => {
    cancelUploadRef.current = true;
    isPausedRef.current = false;
    setIsPaused(false);
    setIsUploading(false);
    setProgressPercent(0);
    setStatusMessage('');
    clearSavedProgress();
    setError('Upload cancelled.');
  };

  // ── Ultra-Rapid Parallel Chunk Uploader ────────────────────────────────────
  const uploadFileInParallelChunks = async (selectedFile: File, videoTitle: string) => {
    setIsUploading(true);
    setIsPaused(false);
    isPausedRef.current = false;
    setError(null);
    setProgressPercent(0);
    cancelUploadRef.current = false;

    // Ultra speed uses 16x parallel workers and 2MB chunks for maximum pipelined speed
    const concurrency = isUltraSpeed ? 16 : 4;
    const chunkSize   = isUltraSpeed ? 2 * 1024 * 1024 : 3 * 1024 * 1024;
    const totalChunks = Math.ceil(selectedFile.size / chunkSize);
    const resumeKey   = `shimpli_upload_${selectedFile.name}_${selectedFile.size}`;

    // Load completed chunk indices from localStorage for resumption
    let completedChunks = new Set<number>();
    try {
      const saved = localStorage.getItem(resumeKey);
      if (saved) {
        completedChunks = new Set(JSON.parse(saved));
        console.log(`[Upload] Resuming upload! ${completedChunks.size}/${totalChunks} chunks already completed.`);
      }
    } catch {}

    // 1. Initialize upload session on server
    setStatusMessage(`Initializing ${concurrency}x Parallel Session...`);
    const initRes = await fetch('/api/upload/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: videoTitle.trim(),
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        totalChunks,
      }),
    });

    const initData = await initRes.json();
    if (!initRes.ok) throw new Error(initData.error || 'Initialization failed');

    const { videoId, jobId } = initData;

    // Track speed and bandwidth
    const startTime = Date.now();
    let uploadedBytesTotal = completedChunks.size * chunkSize;

    // 2. Build worker task queue for remaining chunks
    const chunkIndicesToUpload: number[] = [];
    for (let i = 0; i < totalChunks; i++) {
      if (!completedChunks.has(i)) {
        chunkIndicesToUpload.push(i);
      }
    }

    setStatusMessage(`⚡ ${concurrency}x ${isUltraSpeed ? '🔥 ULTRA SPEED' : 'Rapid'} Workers Uploading...`);

    // Helper worker to upload individual chunk using high-speed ArrayBuffer
    const uploadSingleChunk = async (chunkIndex: number): Promise<void> => {
      if (cancelUploadRef.current) return;

      // Wait loop if paused
      while (isPausedRef.current && !cancelUploadRef.current) {
        await new Promise(r => setTimeout(r, 400));
      }

      if (cancelUploadRef.current) return;

      const startByte = chunkIndex * chunkSize;
      const endByte   = Math.min(startByte + chunkSize, selectedFile.size);
      const chunkBlob = selectedFile.slice(startByte, endByte);

      let attempts = 3;
      while (attempts > 0 && !cancelUploadRef.current) {
        try {
          const res = await fetch('/api/upload/chunk', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'x-video-id': videoId,
              'x-chunk-index': chunkIndex.toString(),
            },
            body: chunkBlob,
          });

          if (res.ok) {
            completedChunks.add(chunkIndex);
            try { localStorage.setItem(resumeKey, JSON.stringify(Array.from(completedChunks))); } catch {}

            uploadedBytesTotal += chunkBlob.size;
            const pct = Math.round((completedChunks.size / totalChunks) * 100);
            setProgressPercent(pct);

            // Calculate live MB/s speed & ETA
            const elapsedSec = (Date.now() - startTime) / 1000;
            if (elapsedSec > 0.2 && !isPausedRef.current) {
              const speedBytesPerSec = uploadedBytesTotal / elapsedSec;
              const mbps = (speedBytesPerSec / (1024 * 1024)).toFixed(1);
              setUploadSpeedMbps(parseFloat(mbps));

              const remainingBytes = selectedFile.size - uploadedBytesTotal;
              const etaSec = Math.round(remainingBytes / speedBytesPerSec);
              setEtaSeconds(Math.max(0, etaSec));
            }
            return;
          }
        } catch (e) {
          attempts--;
          if (attempts === 0) throw e;
          await new Promise(r => setTimeout(r, 400));
        }
      }
    };

    // 3. Run worker pool with 16 (or 4) concurrent connection threads
    let index = 0;
    const workerPool = Array(concurrency).fill(0).map(async () => {
      while (index < chunkIndicesToUpload.length && !cancelUploadRef.current) {
        const chunkIndex = chunkIndicesToUpload[index++];
        await uploadSingleChunk(chunkIndex);
      }
    });

    await Promise.all(workerPool);

    if (cancelUploadRef.current) {
      throw new Error('Upload cancelled');
    }

    // Clear resume storage after completion
    try { localStorage.removeItem(resumeKey); } catch {}

    // 4. Trigger upload completion & Cloud Transcoder
    setStatusMessage('Assembly complete! Triggering 100% Cloud Transcoder...');
    const completeRes = await fetch('/api/upload/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, jobId, totalChunks }),
    });

    const completeData = await completeRes.json();
    if (!completeRes.ok) throw new Error(completeData.error || 'Failed to complete upload');

    onJobCreated(jobId);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) { setError('Please select a video file.'); return; }
    if (!title.trim()) { setError('Please enter a video title.'); return; }

    try {
      await uploadFileInParallelChunks(file, title.trim());
    } catch (err: any) {
      if (err.message !== 'Upload cancelled') {
        setError(err.message || 'Upload failed. Please try again.');
      }
      setIsUploading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-6 w-full max-w-xl mx-auto"
      noValidate
    >
      {/* Drop zone / File picker */}
      <div
        id="upload-dropzone"
        role="button"
        tabIndex={0}
        aria-label="Upload video file"
        onClick={() => !isUploading && fileInputRef.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && !isUploading && fileInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
          relative flex flex-col items-center justify-center gap-3
          min-h-[220px] rounded-3xl border-2 border-dashed cursor-pointer
          transition-all duration-300 p-8 text-center
          ${isDragging
            ? 'border-accent bg-accent/10 scale-[1.01] shadow-glow-red'
            : file
              ? 'border-accent/60 bg-accent/5'
              : 'border-white/15 bg-surface hover:border-accent/40 hover:bg-surface-alt'
          }
        `}
      >
        {file ? (
          <>
            <div className="w-14 h-14 rounded-2xl bg-accent/20 border border-accent/40 flex items-center justify-center shadow-glow-red">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 text-accent">
                <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/>
              </svg>
            </div>
            <div>
              <p className="text-white font-bold text-base truncate max-w-sm">{file.name}</p>
              <p className="text-text-secondary text-xs font-mono mt-1">{(file.size / (1024 * 1024)).toFixed(1)} MB</p>

              {/* Saved Progress Indicator */}
              {savedChunkCount > 0 && !isUploading && (
                <div className="mt-2 text-xs bg-amber-500/20 text-amber-300 px-3 py-1 rounded-xl border border-amber-500/30 flex items-center gap-2">
                  <span>🔄 Found saved progress ({savedChunkCount} chunks)</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); clearSavedProgress(); }}
                    className="text-white hover:underline text-[11px] font-bold"
                  >
                    Start Fresh
                  </button>
                </div>
              )}
            </div>
            {!isUploading && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setFile(null); setTitle(''); clearSavedProgress(); }}
                className="text-accent hover:text-white text-xs font-semibold underline transition-colors"
              >
                Choose different file
              </button>
            )}
          </>
        ) : (
          <>
            <div className="w-16 h-16 rounded-2xl bg-surface-alt border border-white/10 flex items-center justify-center group-hover:scale-110 transition-transform">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-accent">
                <path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>
              </svg>
            </div>
            <div>
              <p className="text-white font-bold text-base">Select or drop a video file</p>
              <p className="text-text-secondary text-xs mt-1">16x Turbo Streams • 5 MB/s - 25 MB/s Ultra Engine</p>
            </div>
            <span className="text-text-secondary/60 text-xs font-mono">Supports 2GB+ files (Ultra Speed Mode Enabled)</span>
          </>
        )}

        <input
          ref={fileInputRef}
          id="upload-file-input"
          type="file"
          accept="video/mp4,video/quicktime,video/webm,video/x-matroska"
          className="sr-only"
          disabled={isUploading}
          onChange={handleInputChange}
        />
      </div>

      {/* Title input */}
      <div className="flex flex-col gap-2">
        <label htmlFor="upload-title" className="text-text-secondary text-xs font-bold uppercase tracking-wider">
          Video Title
        </label>
        <input
          id="upload-title"
          type="text"
          value={title}
          disabled={isUploading}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. If Wishes Could Kill 2026 - Part 1"
          maxLength={120}
          className="
            w-full bg-surface border border-white/10 rounded-2xl
            px-4 py-3.5 text-white text-sm
            placeholder:text-text-secondary/50
            focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent
            transition-all disabled:opacity-50
          "
        />
      </div>

      {/* Ultra Speed Mode Toggle Banner */}
      <div
        onClick={() => !isUploading && setIsUltraSpeed(v => !v)}
        className={`
          flex items-center justify-between p-4 rounded-2xl border cursor-pointer transition-all select-none
          ${isUltraSpeed
            ? 'bg-gradient-to-r from-red-950/60 via-surface-alt to-emerald-950/40 border-accent/50 shadow-glow-red'
            : 'bg-surface-alt border-white/10 opacity-70 hover:opacity-100'
          }
        `}
      >
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold ${isUltraSpeed ? 'bg-accent/20 text-accent border border-accent/40 shadow-glow-red animate-pulse' : 'bg-white/5 text-white/40'}`}>
            ⚡
          </div>
          <div>
            <h4 className="text-white font-bold text-sm flex items-center gap-2">
              ULTRA SPEED MODE
              {isUltraSpeed && <span className="bg-emerald-500/20 text-emerald-400 text-[10px] uppercase px-2 py-0.5 rounded-full font-mono border border-emerald-500/30">16x Turbo</span>}
            </h4>
            <p className="text-text-secondary text-xs">
              {isUltraSpeed ? '16 parallel stream workers for max 5MB/s - 25MB/s bandwidth' : 'Normal mode (4 parallel workers)'}
            </p>
          </div>
        </div>

        {/* Toggle Switch */}
        <div className={`w-12 h-6 rounded-full p-1 transition-colors ${isUltraSpeed ? 'bg-accent' : 'bg-white/20'}`}>
          <div className={`w-4 h-4 rounded-full bg-white transition-transform ${isUltraSpeed ? 'translate-x-6' : 'translate-x-0'}`} />
        </div>
      </div>

      {/* Progress & Control Banner */}
      {isUploading && (
        <div className="flex flex-col gap-3.5 bg-surface-alt/90 border border-accent/30 rounded-2xl p-5 shadow-2xl animate-fade-in">
          <div className="flex items-center justify-between text-xs text-white">
            <span className="font-bold flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isPaused ? 'bg-amber-400' : 'bg-emerald-500 animate-ping'}`} />
              {statusMessage}
            </span>
            <span className="font-mono text-accent font-extrabold text-sm">{progressPercent}%</span>
          </div>

          {/* Glowing Animated Progress Bar */}
          <div className="w-full bg-white/10 rounded-full h-3 overflow-hidden p-0.5 border border-white/5 relative">
            <div
              className={`h-full rounded-full transition-all duration-300 shadow-glow-red ${
                isPaused ? 'bg-amber-500' : 'bg-gradient-to-r from-red-600 via-accent to-emerald-400'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-xs pt-1 border-t border-white/10">
            {/* Speed */}
            <div className="bg-white/5 rounded-xl p-2 flex flex-col items-center">
              <span className="text-white/50 text-[10px] uppercase font-bold tracking-wider">Rapid Speed</span>
              <span className="text-emerald-400 font-extrabold font-mono text-sm mt-0.5">
                {isPaused ? '0 MB/s' : `⚡ ${uploadSpeedMbps} MB/s`}
              </span>
            </div>

            {/* Transferred MB */}
            <div className="bg-white/5 rounded-xl p-2 flex flex-col items-center">
              <span className="text-white/50 text-[10px] uppercase font-bold tracking-wider">Transferred</span>
              <span className="text-white font-bold font-mono text-xs mt-0.5">
                {file ? `${((progressPercent / 100) * (file.size / (1024 * 1024))).toFixed(0)} / ${(file.size / (1024 * 1024)).toFixed(0)} MB` : '0 MB'}
              </span>
            </div>

            {/* ETA */}
            <div className="bg-white/5 rounded-xl p-2 flex flex-col items-center">
              <span className="text-white/50 text-[10px] uppercase font-bold tracking-wider">Est. Time</span>
              <span className="text-accent font-bold font-mono text-xs mt-0.5">
                {isPaused ? 'Paused' : `⏳ ${etaSeconds > 60 ? `${Math.floor(etaSeconds / 60)}m ${etaSeconds % 60}s` : `${etaSeconds}s`}`}
              </span>
            </div>
          </div>

          {/* Pause & Cancel Controls Row */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              id="upload-pause-btn"
              onClick={handleTogglePause}
              className="flex-1 py-2 px-4 bg-white/10 hover:bg-white/20 text-white font-bold text-xs rounded-xl border border-white/10 transition-all flex items-center justify-center gap-2"
            >
              {isPaused ? (
                <>
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-emerald-400"><path d="M8 5v14l11-7z"/></svg>
                  Resume Upload
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-amber-400"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                  Pause Upload
                </>
              )}
            </button>

            <button
              type="button"
              id="upload-cancel-btn"
              onClick={handleCancelUpload}
              className="py-2 px-4 bg-danger/20 hover:bg-danger text-danger hover:text-white font-bold text-xs rounded-xl border border-danger/30 transition-all flex items-center justify-center gap-1.5"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 bg-danger/10 border border-danger/30 rounded-2xl px-4 py-3.5"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-danger shrink-0 mt-0.5">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
          </svg>
          <p className="text-danger text-sm">{error}</p>
        </div>
      )}

      {/* Submit button */}
      <button
        id="upload-submit-btn"
        type="submit"
        disabled={isUploading || !file}
        className={`
          w-full min-h-[50px] px-6 py-3.5 font-bold text-sm md:text-base rounded-2xl shadow-glow-red
          transition-all active:scale-[0.98] flex items-center justify-center gap-2 border border-white/10
          ${isUltraSpeed
            ? 'bg-gradient-to-r from-red-600 via-accent to-emerald-600 hover:from-accent hover:to-emerald-500 text-white'
            : 'bg-gradient-to-r from-accent to-[#B81D24] text-white'
          }
          disabled:bg-surface-alt disabled:text-text-secondary disabled:cursor-not-allowed disabled:shadow-none
        `}
      >
        {isUploading ? (
          <>
            <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            {isUltraSpeed ? '⚡ Ultra Speed Upload…' : 'Rapid Upload In Progress…'} ({progressPercent}%)
          </>
        ) : (
          isUltraSpeed ? '⚡ Upload in ULTRA SPEED (16x Turbo)' : 'Upload & Cloud Transcode'
        )}
      </button>
    </form>
  );
}
