import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import os from 'os';
import type { ApiError } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ─── Validation schema ────────────────────────────────────────────────────────

const ALLOWED_MIMETYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;
const MAX_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB

const uploadSchema = z.object({
  title: z.string().min(1, 'Title is required').max(120, 'Title must be 120 characters or less'),
});

// ─── Async pipeline (runs after HTTP response is sent) ────────────────────────

async function runPipeline(
  tmpFilePath: string,
  videoId: string,
  jobId: string,
  title: string
): Promise<void> {
  // Dynamic imports so they don't block the module load
  const { transcodeToHLS } = await import('../../../scripts/transcode.js');
  const { uploadHLSToB2 } = await import('../../../scripts/upload-to-b2.js');
  const {
    updateUploadJob,
    updateVideoRecord,
  } = await import('@/lib/supabase-client');

  const outputDir = join(os.tmpdir(), `hls-${videoId}`);

  try {
    // Phase 1: Transcoding
    await updateUploadJob(jobId, { status: 'transcoding', progress_percent: 5 });

    const transcodeResult = await transcodeToHLS(tmpFilePath, outputDir);

    await updateUploadJob(jobId, { status: 'uploading', progress_percent: 60 });

    // Phase 2: Upload to B2 (private bucket)
    const uploadResult = await uploadHLSToB2(outputDir, videoId);

    await updateUploadJob(jobId, { progress_percent: 90 });

    // Phase 3: Update video record
    // master_manifest_url stores the B2 key prefix (e.g. videos/{videoId})
    // The full URL is constructed at runtime: NEXT_PUBLIC_STREAM_BASE_URL/video/{videoId}/master.m3u8
    await updateVideoRecord(videoId, {
      status: 'ready',
      master_manifest_url: uploadResult.b2KeyPrefix,
      available_qualities: transcodeResult.qualities.map((q: { label: string }) => q.label),
      duration_seconds: transcodeResult.durationSeconds,
      transcode_log: {
        ...transcodeResult,
        uploadedFiles: uploadResult.fileCount,
        totalBytesUploaded: uploadResult.totalBytesUploaded,
      } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    });

    await updateUploadJob(jobId, {
      status: 'done',
      progress_percent: 100,
    });

    console.log(`[upload] Pipeline complete for video ${videoId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[upload] Pipeline failed for video ${videoId}:`, message);

    await updateUploadJob(jobId, {
      status: 'error',
      progress_percent: 0,
      error_message: message,
    }).catch(() => {});

    await updateVideoRecord(videoId, { status: 'failed' }).catch(() => {});
  }
}

// ─── POST /api/upload ─────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const formData = await request.formData();

    // Validate title
    const titleRaw = formData.get('title');
    const titleParse = uploadSchema.safeParse({ title: titleRaw });
    if (!titleParse.success) {
      const err: ApiError = {
        error: titleParse.error.issues[0]?.message ?? 'Validation error',
        code: 'VALIDATION_ERROR',
      };
      return NextResponse.json(err, { status: 400 });
    }

    // Validate file
    const file = formData.get('file');
    if (!file || !(file instanceof Blob)) {
      const err: ApiError = { error: 'No video file provided', code: 'MISSING_FILE' };
      return NextResponse.json(err, { status: 400 });
    }

    if (!ALLOWED_MIMETYPES.includes(file.type as typeof ALLOWED_MIMETYPES[number])) {
      const err: ApiError = {
        error: `Unsupported file type: ${file.type}. Allowed: ${ALLOWED_MIMETYPES.join(', ')}`,
        code: 'INVALID_FILE_TYPE',
      };
      return NextResponse.json(err, { status: 415 });
    }

    if (file.size > MAX_SIZE_BYTES) {
      const err: ApiError = {
        error: `File too large (${(file.size / 1024 / 1024).toFixed(0)} MB). Maximum is 500 MB.`,
        code: 'FILE_TOO_LARGE',
      };
      return NextResponse.json(err, { status: 413 });
    }

    // Create DB records
    const { createVideoRecord, createUploadJob } = await import('@/lib/supabase-client');
    const video = await createVideoRecord({
      title: titleParse.data.title,
      master_manifest_url: '',
      available_qualities: [],
    });
    const job = await createUploadJob(video.id);

    // Save file to /tmp
    const ext = (file as File).name?.split('.').pop() ?? 'mp4';
    const tmpFilePath = join(os.tmpdir(), `upload-${video.id}.${ext}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    await mkdir(os.tmpdir(), { recursive: true });
    await writeFile(tmpFilePath, buffer);

    // Kick off async pipeline — don't await it (don't block HTTP response)
    runPipeline(tmpFilePath, video.id, job.id, titleParse.data.title).catch((err) => {
      console.error('[upload] Unhandled pipeline error:', err);
    });

    return NextResponse.json({ jobId: job.id, videoId: video.id }, { status: 202 });
  } catch (err) {
    console.error('[POST /api/upload] Unexpected error:', err);
    const error: ApiError = {
      error: 'Internal server error. Please try again.',
      code: 'INTERNAL_ERROR',
    };
    return NextResponse.json(error, { status: 500 });
  }
}

