import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getVideoById } from '@/lib/supabase-client';
import type { ApiError, VideoResponse } from '@/lib/types';

const paramsSchema = z.object({
  id: z.string().uuid('Invalid video ID format'),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const parse = paramsSchema.safeParse(params);
  if (!parse.success) {
    const err: ApiError = {
      error: parse.error.issues[0]?.message ?? 'Invalid video ID',
      code: 'INVALID_VIDEO_ID',
    };
    return NextResponse.json(err, { status: 400 });
  }

  const { id } = parse.data;

  try {
    const video = await getVideoById(id);

    if (!video) {
      const err: ApiError = { error: 'Video not found', code: 'VIDEO_NOT_FOUND' };
      return NextResponse.json(err, { status: 404 });
    }

    // master_manifest_url in DB stores the B2 key prefix (e.g. "videos/{videoId}")
    // Construct the full stream URL through the Cloudflare Worker proxy
    const streamBase = process.env.NEXT_PUBLIC_STREAM_BASE_URL?.replace(/\/$/, '') ?? '';
    const b2KeyPrefix = video.master_manifest_url || ''; // e.g. "videos/{videoId}"
    // Convert "videos/{videoId}" → "/video/{videoId}" (Worker route format)
    const workerPath = b2KeyPrefix.replace(/^videos\//, '/video/');
    const masterManifestUrl = video.status === 'ready' && streamBase
      ? `${streamBase}${workerPath}/master.m3u8`
      : video.master_manifest_url; // fallback for processing state

    const response: VideoResponse = {
      id: video.id,
      title: video.title,
      description: video.description,
      masterManifestUrl,
      availableQualities: video.available_qualities,
      durationSeconds: video.duration_seconds,
      thumbnailUrl: video.thumbnail_url,
      status: video.status,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error(`[GET /api/videos/${id}] Error:`, err);
    const error: ApiError = {
      error: 'Failed to fetch video. Please try again.',
      code: 'INTERNAL_ERROR',
    };
    return NextResponse.json(error, { status: 500 });
  }
}
