'use client';

import { useState, useRef, useCallback } from 'react';
import type { ChangeEvent, DragEvent, FormEvent } from 'react';

interface UploadFormProps {
  onJobCreated: (jobId: string) => void;
}

const ACCEPTED_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
const MAX_SIZE_MB = 500;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

export default function UploadForm({ onJobCreated }: UploadFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = useCallback((f: File): string | null => {
    if (!ACCEPTED_TYPES.includes(f.type)) {
      return `Unsupported file type: ${f.type}. Please upload MP4, MOV, or WebM.`;
    }
    if (f.size > MAX_SIZE_BYTES) {
      return `File too large (${(f.size / 1024 / 1024).toFixed(0)} MB). Maximum is ${MAX_SIZE_MB} MB.`;
    }
    return null;
  }, []);

  const handleFileChange = useCallback((f: File | null) => {
    if (!f) return;
    const err = validateFile(f);
    if (err) {
      setError(err);
      setFile(null);
    } else {
      setError(null);
      setFile(f);
      if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
    }
  }, [validateFile, title]);

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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) { setError('Please select a video file.'); return; }
    if (!title.trim()) { setError('Please enter a title.'); return; }

    setIsSubmitting(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', title.trim());

      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? `Upload failed with status ${res.status}`);
      }

      onJobCreated(data.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
      setIsSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-5 w-full max-w-lg mx-auto"
      noValidate
    >
      {/* Drop zone / File picker */}
      <div
        id="upload-dropzone"
        role="button"
        tabIndex={0}
        aria-label="Upload video file"
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
          relative flex flex-col items-center justify-center gap-3
          min-h-[180px] rounded-2xl border-2 border-dashed cursor-pointer
          transition-all duration-200 p-6 text-center
          ${isDragging
            ? 'border-accent bg-accent/10 scale-[1.01]'
            : file
              ? 'border-accent/50 bg-accent/5'
              : 'border-white/20 bg-surface hover:border-accent/50 hover:bg-surface-alt'
          }
        `}
      >
        {file ? (
          <>
            <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-accent">
                <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/>
              </svg>
            </div>
            <div>
              <p className="text-text-primary font-semibold text-sm truncate max-w-xs">{file.name}</p>
              <p className="text-text-secondary text-xs mt-0.5">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setFile(null); setTitle(''); }}
              className="text-text-secondary hover:text-danger text-xs underline"
            >
              Remove
            </button>
          </>
        ) : (
          <>
            <div className="w-14 h-14 rounded-full bg-surface-alt flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 text-text-secondary">
                <path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>
              </svg>
            </div>
            <div>
              <p className="text-text-primary font-semibold text-sm">Tap to choose video</p>
              <p className="text-text-secondary text-xs mt-1">or drag & drop here</p>
            </div>
            <p className="text-text-secondary text-xs">MP4, MOV, WebM · max {MAX_SIZE_MB} MB</p>
          </>
        )}

        <input
          ref={fileInputRef}
          id="upload-file-input"
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          className="sr-only"
          onChange={handleInputChange}
        />
      </div>

      {/* Title input */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="upload-title" className="text-text-secondary text-xs font-medium uppercase tracking-wide">
          Title
        </label>
        <input
          id="upload-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Enter a title for your video"
          maxLength={120}
          className="
            w-full bg-surface border border-white/10 rounded-xl
            px-4 py-3 text-text-primary text-sm
            placeholder:text-text-secondary/50
            focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent
            transition-all
          "
        />
      </div>

      {/* Error message */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 bg-danger/10 border border-danger/30 rounded-xl px-4 py-3"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-danger shrink-0 mt-0.5">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
          </svg>
          <p className="text-danger text-sm">{error}</p>
        </div>
      )}

      {/* Submit button — min-height 48px */}
      <button
        id="upload-submit-btn"
        type="submit"
        disabled={isSubmitting || !file}
        className="
          w-full min-h-[48px] px-6 py-3
          bg-accent hover:bg-accent/80
          disabled:bg-surface-alt disabled:text-text-secondary disabled:cursor-not-allowed
          text-white font-semibold text-sm rounded-xl
          transition-all active:scale-[0.98]
          flex items-center justify-center gap-2
        "
      >
        {isSubmitting ? (
          <>
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            Uploading…
          </>
        ) : 'Upload Video'}
      </button>
    </form>
  );
}
