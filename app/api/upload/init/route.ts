import { NextRequest, NextResponse } from 'next/server';
import { createVideoRecord, createUploadJob } from '@/lib/supabase-client';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { title, fileName, fileSize, totalChunks } = await req.json();

    if (!title || !fileSize || !totalChunks) {
      return NextResponse.json({ error: 'Missing title, fileSize or totalChunks' }, { status: 400 });
    }

    const video = await createVideoRecord({
      title: title.trim(),
      master_manifest_url: '',
      available_qualities: [],
    });

    const job = await createUploadJob(video.id);

    const sessionId = `session_${video.id}`;
    const chunkSize = 3 * 1024 * 1024; // 3MB per chunk (fits Vercel serverless limit)

    return NextResponse.json({
      sessionId,
      videoId: video.id,
      jobId: job.id,
      chunkSize,
      totalChunks,
    });
  } catch (err: any) {
    console.error('[Upload Init Error]:', err);
    return NextResponse.json({ error: err.message || 'Failed to initialize upload session' }, { status: 500 });
  }
}
