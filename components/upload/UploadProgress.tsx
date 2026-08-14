'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { UploadStatusResponse, JobStatus } from '@/lib/types';

interface UploadProgressProps {
  jobId: string;
}

const STAGE_LABELS: Record<string, string> = {
  queued:      'Waiting in queue…',
  transcoding: 'Transcoding video…',
  uploading:   'Uploading to storage…',
  done:        'Processing complete!',
  error:       'Something went wrong',
};

// Approximate progress breakpoints per stage (for visual continuity)
const STAGE_PROGRESS: Record<JobStatus, number> = {
  queued:      5,
  processing:  30,
  transcoding: 60,
  uploading:   90,
  ready:       100,
  done:        100,
  failed:      100,
  error:       100,
};

// Detailed messages shown during transcoding based on progress
function getTranscodeStageLabel(progress: number): string {
  if (progress < 15) return 'Transcoding 240p…';
  if (progress < 30) return 'Transcoding 360p…';
  if (progress < 50) return 'Transcoding 480p…';
  if (progress < 70) return 'Transcoding 720p…';
  return 'Finalising transcoding…';
}

export default function UploadProgress({ jobId }: UploadProgressProps) {
  const router = useRouter();
  const [status, setStatus] = useState<JobStatus>('queued');
  const [progress, setProgress] = useState(0);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/upload-status/${jobId}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Status check failed (${res.status})`);
      }
      const data: UploadStatusResponse = await res.json();
      const jobStatus = data.status ?? data.job?.status ?? 'queued';
      const pct = data.progressPercent ?? data.job?.progressPercent ?? STAGE_PROGRESS[jobStatus] ?? 0;
      const vId = data.videoId ?? data.job?.videoId ?? data.job?.video_id;
      const errMsg = data.errorMessage ?? data.job?.errorMessage ?? data.job?.error_message;

      setStatus(jobStatus);
      setProgress(pct);
      if (vId) setVideoId(vId);
      if (errMsg) setErrorMessage(errMsg);
      return jobStatus;
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to fetch status');
      setStatus('error');
      return 'error' as JobStatus;
    }
  }, [jobId]);

  // Polling loop
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;

    const tick = async () => {
      const currentStatus = await poll();
      const isTerminal = currentStatus === 'done' || currentStatus === 'error';
      if (!isTerminal) {
        timeout = setTimeout(tick, 2000);
      }
    };

    tick();
    return () => clearTimeout(timeout);
  }, [poll]);

  // Elapsed time counter
  useEffect(() => {
    const interval = setInterval(() => {
      if (status !== 'done' && status !== 'error') {
        setElapsed((s) => s + 1);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [status]);

  // Auto-navigate on done
  useEffect(() => {
    if (status === 'done' && videoId) {
      const t = setTimeout(() => router.push(`/watch/${videoId}`), 1500);
      return () => clearTimeout(t);
    }
  }, [status, videoId, router]);

  const displayLabel = status === 'transcoding'
    ? getTranscodeStageLabel(progress)
    : (STAGE_LABELS[status] ?? 'Processing…');

  const formatElapsed = (s: number) =>
    s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;

  return (
    <div
      className="w-full max-w-lg mx-auto bg-surface rounded-2xl border border-white/10 p-6 flex flex-col gap-5"
      role="status"
      aria-live="polite"
      aria-label="Upload progress"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-text-primary font-semibold text-sm">
          {status === 'done' ? '✅ Upload Complete!' : status === 'error' ? '❌ Upload Failed' : '⚙️ Processing…'}
        </h2>
        {status !== 'done' && status !== 'error' && (
          <span className="text-text-secondary text-xs tabular-nums">{formatElapsed(elapsed)}</span>
        )}
      </div>

      {/* Progress bar */}
      <div className="flex flex-col gap-2">
        <div className="w-full h-2 bg-surface-alt rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              status === 'error' ? 'bg-danger' : status === 'done' ? 'bg-green-500' : 'bg-accent'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-text-secondary text-xs">{displayLabel}</span>
          <span className="text-text-secondary text-xs tabular-nums">{progress}%</span>
        </div>
      </div>

      {/* Stage pills */}
      <div className="flex items-center gap-1 text-xs">
        {(['queued', 'transcoding', 'uploading', 'done'] as JobStatus[]).map((stage, i) => {
          const stages: JobStatus[] = ['queued', 'transcoding', 'uploading', 'done'];
          const currentIdx = stages.indexOf(status);
          const stageIdx = stages.indexOf(stage);
          const isComplete = currentIdx > stageIdx;
          const isCurrent = currentIdx === stageIdx;

          return (
            <div key={stage} className="flex items-center gap-1">
              <div
                className={`
                  px-2.5 py-1 rounded-full font-medium transition-all
                  ${isComplete ? 'bg-accent/20 text-accent' :
                    isCurrent ? 'bg-accent text-white' :
                    'bg-surface-alt text-text-secondary'}
                `}
              >
                {stage.charAt(0).toUpperCase() + stage.slice(1)}
              </div>
              {i < 3 && (
                <div className={`w-3 h-px ${isComplete ? 'bg-accent' : 'bg-white/10'}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Error message */}
      {status === 'error' && errorMessage && (
        <div className="bg-danger/10 border border-danger/30 rounded-xl px-4 py-3">
          <p className="text-danger text-sm">{errorMessage}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 text-xs text-danger underline"
          >
            Try again
          </button>
        </div>
      )}

      {/* Watch button on complete */}
      {status === 'done' && videoId && (
        <a
          href={`/watch/${videoId}`}
          id="upload-watch-btn"
          className="
            w-full min-h-[48px] flex items-center justify-center
            bg-accent hover:bg-accent/80 text-white font-semibold text-sm rounded-xl
            transition-all active:scale-[0.98]
          "
        >
          Watch Video →
        </a>
      )}
    </div>
  );
}
