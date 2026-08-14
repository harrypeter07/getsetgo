import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
// @ts-ignore
import B2 from 'backblaze-b2';
import { updateVideoRecord, updateUploadJob } from '@/lib/supabase-client';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { videoId, jobId } = await req.json();

    if (!videoId) {
      return NextResponse.json({ error: 'Missing videoId' }, { status: 400 });
    }

    console.log(`[Upload Cancel] Cleaning up storage for cancelled video: ${videoId}`);

    // 1. Delete local temporary chunk folder & raw temp files
    const chunkDir = path.join(os.tmpdir(), `chunks_${videoId}`);
    const rawPath  = path.join(os.tmpdir(), `raw_${videoId}.mp4`);

    try {
      if (fs.existsSync(chunkDir)) {
        fs.rmSync(chunkDir, { recursive: true, force: true });
        console.log(`[Upload Cancel] Deleted local chunk directory: ${chunkDir}`);
      }
      if (fs.existsSync(rawPath)) {
        fs.rmSync(rawPath, { force: true });
        console.log(`[Upload Cancel] Deleted local raw temp file: ${rawPath}`);
      }
    } catch (fsErr) {
      console.warn('[Upload Cancel] Failed to delete local temp files:', fsErr);
    }

    // 2. Delete any partial files from Backblaze B2 bucket
    const b2KeyId  = process.env.B2_KEY_ID || process.env.B2_APPLICATION_KEY_ID;
    const b2AppKey = process.env.B2_APPLICATION_KEY;
    const b2Bucket = process.env.B2_BUCKET_NAME || 'getitfast';

    if (b2KeyId && b2AppKey) {
      try {
        const b2 = new B2({ applicationKeyId: b2KeyId, applicationKey: b2AppKey });
        const auth = await b2.authorize();
        const bucketId = auth.data.allowed.bucketId;

        // List files with prefix raw/<videoId> and delete them
        const prefix = `raw/${videoId}`;
        const { data: listData } = await b2.listFileNames({
          bucketId,
          startFileName: prefix,
          maxFileCount: 100,
          prefix,
        });

        if (listData && listData.files && listData.files.length > 0) {
          for (const f of listData.files) {
            await b2.deleteFileVersion({
              fileName: f.fileName,
              fileId: f.fileId,
            });
            console.log(`[Upload Cancel] Deleted B2 file: ${f.fileName}`);
          }
        }
      } catch (b2Err) {
        console.warn('[Upload Cancel] B2 file cleanup notice:', b2Err);
      }
    }

    // 3. Update Supabase video & job status to cancelled
    try {
      await updateVideoRecord(videoId, { status: 'failed' });
      if (jobId) await updateUploadJob(jobId, { status: 'failed', error_message: 'Upload cancelled by user' });
    } catch (dbErr) {
      console.warn('[Upload Cancel] DB update notice:', dbErr);
    }

    return NextResponse.json({
      success: true,
      videoId,
      message: 'Upload cancelled and storage successfully freed!',
    });
  } catch (err: any) {
    console.error('[Upload Cancel Error]:', err);
    return NextResponse.json({ error: err.message || 'Failed to cancel upload session' }, { status: 500 });
  }
}
