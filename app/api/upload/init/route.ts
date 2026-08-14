import { NextRequest, NextResponse } from 'next/server';
import { createVideoRecord, createUploadJob } from '@/lib/supabase-client';
// @ts-ignore
import B2 from 'backblaze-b2';

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

    // Get B2 Direct Upload URL for browser -> B2 direct speed
    const b2KeyId  = process.env.B2_KEY_ID || process.env.B2_APPLICATION_KEY_ID;
    const b2AppKey = process.env.B2_APPLICATION_KEY;

    let b2UploadUrl = '';
    let b2AuthToken = '';

    if (b2KeyId && b2AppKey) {
      try {
        const b2 = new B2({ applicationKeyId: b2KeyId, applicationKey: b2AppKey });
        const auth = await b2.authorize();
        const bucketId = auth.data.allowed.bucketId;
        const { data: uploadData } = await b2.getUploadUrl({ bucketId });
        b2UploadUrl = uploadData.uploadUrl;
        b2AuthToken = uploadData.authorizationToken;
      } catch (err) {
        console.warn('[Upload Init] Failed to get B2 direct upload URL, falling back to serverless chunks:', err);
      }
    }

    const sessionId = `session_${video.id}`;
    const chunkSize = 5 * 1024 * 1024; // 5MB per chunk for direct B2 stream

    return NextResponse.json({
      sessionId,
      videoId: video.id,
      jobId: job.id,
      chunkSize,
      totalChunks,
      b2UploadUrl,
      b2AuthToken,
    });
  } catch (err: any) {
    console.error('[Upload Init Error]:', err);
    return NextResponse.json({ error: err.message || 'Failed to initialize upload session' }, { status: 500 });
  }
}
