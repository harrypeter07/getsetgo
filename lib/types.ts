// lib/types.ts

export type VideoStatus = 'queued' | 'uploading' | 'transcoding' | 'ready' | 'failed' | 'processing' | 'done' | 'error';
export type JobStatus   = VideoStatus;

export interface Video {
  id: string;
  title: string;
  description?: string | null;
  duration_seconds?: number | null;
  durationSeconds?: number | null;
  master_manifest_url?: string | null;
  masterManifestUrl?: string | null;
  available_qualities?: string[] | null;
  availableQualities?: string[] | null;
  thumbnail_url?: string | null;
  thumbnailUrl?: string | null;
  status: VideoStatus;
  transcode_log?: Record<string, unknown> | null;
  created_at?: string;
  view_count?: number;
}

export interface UploadJob {
  id?: string;
  videoId?: string;
  video_id?: string;
  status?: VideoStatus;
  progressPercent?: number;
  progress_percent?: number;
  currentQuality?: string;
  error?: string;
  error_message?: string;
  errorMessage?: string;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
}

export interface QualityLevel {
  label: string;
  width: number;
  height: number;
  bitrateKbps: number;
}

export interface TranscodeResult {
  qualities: QualityLevel[];
  masterManifestPath: string;
  durationSeconds: number;
  ffmpegVersion: string;
  transcodeTimeMs: number;
  hostname: string;
  nodeVersion: string;
  environment: 'local' | 'ci' | 'cloud';
}

export interface UploadSession {
  sessionId: string;
  videoId: string;
  fileName: string;
  fileSize: number;
  chunkSize: number;
  totalChunks: number;
  uploadedChunks: number[];
}

export interface ApiError {
  error: string;
  code?: string;
}

export interface VideoResponse extends Partial<Video> {
  id?: string;
  video?: Video;
  streamUrl?: string;
}

export interface UploadStatusResponse extends Partial<UploadJob> {
  job?: UploadJob;
  video?: Video;
  status?: VideoStatus;
  progressPercent?: number;
  videoId?: string;
  errorMessage?: string;
}
