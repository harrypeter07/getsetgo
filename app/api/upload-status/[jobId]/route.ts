import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUploadJob } from '@/lib/supabase-client';
import type { ApiError, UploadStatusResponse } from '@/lib/types';

const paramsSchema = z.object({
  jobId: z.string().uuid('Invalid job ID format'),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: { jobId: string } }
): Promise<NextResponse> {
  const parse = paramsSchema.safeParse(params);
  if (!parse.success) {
    const err: ApiError = {
      error: parse.error.issues[0]?.message ?? 'Invalid job ID',
      code: 'INVALID_JOB_ID',
    };
    return NextResponse.json(err, { status: 400 });
  }

  const { jobId } = parse.data;

  try {
    const job = await getUploadJob(jobId);

    if (!job) {
      const err: ApiError = { error: 'Job not found', code: 'JOB_NOT_FOUND' };
      return NextResponse.json(err, { status: 404 });
    }

    const response: UploadStatusResponse = {
      status: job.status,
      progressPercent: job.progress_percent,
      ...(job.video_id ? { videoId: job.video_id } : {}),
      ...(job.error_message ? { errorMessage: job.error_message } : {}),
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error(`[GET /api/upload-status/${jobId}] Error:`, err);
    const error: ApiError = {
      error: 'Failed to fetch job status. Please try again.',
      code: 'INTERNAL_ERROR',
    };
    return NextResponse.json(error, { status: 500 });
  }
}
