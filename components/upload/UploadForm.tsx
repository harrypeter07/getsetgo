'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { ChangeEvent, DragEvent, FormEvent } from 'react';

interface UploadFormProps {
  onJobCreated: (jobId: string) => void;
}

const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB chunks
const CONCURRENCY = 4; // 4 parallel upload workers for max speed

export default function UploadForm({ onJobCreated }: UploadFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Upload progress states
  const [progressPercent, setProgressPercent] = useState(0);
  const [uploadSpeedMbps, setUploadSpeedMbps] = useState(0);
  const [etaSeconds, setEtaSeconds] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelUploadRef = useRef(false);

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

  // ── Parallel Resumable Chunk Uploader ──────────────────────────────────────
  const uploadFileInParallelChunks = async (selectedFile: File, videoTitle: string) => {
    setIsUploading(true);
    setError(null);
    setProgressPercent(0);
    cancelUploadRef.current = false;

    const totalChunks = Math.ceil(selectedFile.size / CHUNK_SIZE);
    const resumeKey = `shimpli_upload_${selectedFile.name}_${selectedFile.size}`;

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
    setStatusMessage('Initializing upload session...');
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
    let uploadedBytesTotal = completedChunks.size * CHUNK_SIZE;

    // 2. Build worker task queue for remaining chunks
    const chunkIndicesToUpload: number[] = [];
    for (let i = 0; i < totalChunks; i++) {
      if (!completedChunks.has(i)) {
        chunkIndicesToUpload.push(i);
      }
    }

    setStatusMessage(`Uploading in parallel (${CONCURRENCY} connections)...`);

    // Helper worker to upload individual chunk
    const uploadSingleChunk = async (chunkIndex: number): Promise<void> => {
      if (cancelUploadRef.current) return;

      const startByte = chunkIndex * CHUNK_SIZE;
      const endByte   = Math.min(startByte + CHUNK_SIZE, selectedFile.size);
      const chunkBlob = selectedFile.slice(startByte, endByte);

      const formData = new FormData();
      formData.append('videoId', videoId);
      formData.append('chunkIndex', chunkIndex.toString());
      formData.append('chunk', chunkBlob, `chunk_${chunkIndex}`);

      let attempts = 3;
      while (attempts > 0) {
        try {
          const res = await fetch('/api/upload/chunk', { method: 'POST', body: formData });
          if (res.ok) {
            completedChunks.add(chunkIndex);
            // Save completed progress to localStorage
            try { localStorage.setItem(resumeKey, JSON.stringify(Array.from(completedChunks))); } catch {}

            uploadedBytesTotal += chunkBlob.size;
            const pct = Math.round((completedChunks.size / totalChunks) * 100);
            setProgressPercent(pct);

            // Calculate live MB/s and ETA
            const elapsedSec = (Date.now() - startTime) / 1000;
            if (elapsedSec > 0.5) {
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
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    };

    // 3. Run worker pool with max CONCURRENCY connections
    let index = 0;
    const workerPool = Array(CONCURRENCY).fill(0).map(async () => {
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

    // 4. Send upload completion trigger to server
    setStatusMessage('Chunks assembled! Dispatching 100% Cloud Transcoder...');
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
      setError(err.message || 'Upload failed. Please try again.');
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
            </div>
            {!isUploading && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setFile(null); setTitle(''); }}
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
              <p className="text-text-secondary text-xs mt-1">100% Cloud HLS Transcoding • Multi-Audio & Subtitles</p>
            </div>
            <span className="text-text-secondary/60 text-xs font-mono">Supports 2GB+ files (Parallel Resumable Upload)</span>
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

      {/* Progress & Speed Bar */}
      {isUploading && (
        <div className="flex flex-col gap-2.5 bg-surface-alt/70 border border-white/10 rounded-2xl p-4 animate-fade-in">
          <div className="flex items-center justify-between text-xs text-white">
            <span className="font-semibold">{statusMessage}</span>
            <span className="font-mono text-accent font-bold">{progressPercent}%</span>
          </div>

          {/* Bar */}
          <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
            <div
              className="bg-gradient-to-r from-accent to-red-500 h-full rounded-full transition-all duration-300 shadow-glow-red"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-xs text-text-secondary font-mono">
            <span>🚀 Speed: <strong className="text-white">{uploadSpeedMbps} MB/s</strong></span>
            <span>⏳ ETA: <strong className="text-white">{etaSeconds}s</strong></span>
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
        className="
          w-full min-h-[50px] px-6 py-3.5
          bg-gradient-to-r from-accent to-[#B81D24] hover:from-accent-hover hover:to-accent
          disabled:bg-surface-alt disabled:text-text-secondary disabled:cursor-not-allowed disabled:shadow-none
          text-white font-bold text-sm md:text-base rounded-2xl shadow-glow-red
          transition-all active:scale-[0.98]
          flex items-center justify-center gap-2 border border-white/10
        "
      >
        {isUploading ? (
          <>
            <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            Uploading in Parallel… ({progressPercent}%)
          </>
        ) : 'Upload & Cloud Transcode'}
      </button>
    </form>
  );
}
