// Shared TypeScript types for the streaming platform

export type VideoStatus = 'processing' | 'ready' | 'failed';
export type JobStatus = 'queued' | 'transcoding' | 'uploading' | 'done' | 'error';

export interface QualityLevel {
  label: string;
  width: number;
  height: number;
  bitrateKbps: number;
}

export interface TranscodeMetadata {
  qualities: QualityLevel[];
  masterManifestPath: string;
  durationSeconds: number;
  ffmpegVersion: string;
  transcodeTimeMs: number;
  hostname: string;
  nodeVersion: string;
  environment: 'local' | 'ci' | 'cloud';
}

export interface Video {
  id: string;
  title: string;
  description?: string;
  duration_seconds?: number;
  master_manifest_url: string;
  available_qualities: string[];
  thumbnail_url?: string;
  status: VideoStatus;
  transcode_log?: TranscodeMetadata;
  created_at: string;
  view_count: number;
}

export interface UploadJob {
  id: string;
  video_id?: string;
  status: JobStatus;
  error_message?: string;
  progress_percent: number;
  updated_at: string;
}

export interface UploadStatusResponse {
  status: JobStatus;
  progressPercent: number;
  videoId?: string;
  errorMessage?: string;
}

export interface VideoResponse {
  id: string;
  title: string;
  description?: string;
  masterManifestUrl: string;
  availableQualities: string[];
  durationSeconds?: number;
  thumbnailUrl?: string;
  status: VideoStatus;
}

export interface ApiError {
  error: string;
  code: string;
}

export interface UploadResponse {
  jobId: string;
}

export interface R2UploadResult {
  masterManifestUrl: string;
  totalBytesUploaded: number;
  fileCount: number;
}
