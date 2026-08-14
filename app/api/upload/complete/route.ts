import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
// @ts-ignore
import B2 from 'backblaze-b2';
import { updateVideoRecord, updateUploadJob } from '@/lib/supabase-client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { videoId, jobId, totalChunks } = await req.json();

    if (!videoId || !totalChunks) {
      return NextResponse.json({ error: 'Missing videoId or totalChunks' }, { status: 400 });
    }

    const chunkDir = path.join(os.tmpdir(), `chunks_${videoId}`);
    const rawPath  = path.join(os.tmpdir(), `raw_${videoId}.mp4`);

    // Verify all chunks exist and assemble
    const rawStream = fs.createWriteStream(rawPath);
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(chunkDir, `chunk_${String(i).padStart(5, '0')}`);
      if (!fs.existsSync(chunkPath)) {
        throw new Error(`Missing chunk index ${i}`);
      }
      const buffer = fs.readFileSync(chunkPath);
      rawStream.write(buffer);
    }
    rawStream.end();

    // Wait for file stream finish
    await new Promise<void>((resolve, reject) => {
      rawStream.on('finish', () => resolve());
      rawStream.on('error', (err) => reject(err));
    });

    // Upload raw file to Backblaze B2 under raw/<videoId>.mp4
    const b2KeyId  = process.env.B2_APPLICATION_KEY_ID!;
    const b2AppKey = process.env.B2_APPLICATION_KEY!;
    const b2Bucket = process.env.B2_BUCKET_NAME!;

    const b2 = new B2({ applicationKeyId: b2KeyId, applicationKey: b2AppKey });
    await b2.authorize();

    const { data: bucketData } = await b2.listBuckets();
    const bucket = bucketData.buckets.find((b: any) => b.bucketName === b2Bucket);
    if (!bucket) throw new Error(`Bucket "${b2Bucket}" not found`);

    const rawKey = `raw/${videoId}.mp4`;
    const { data: uploadUrlData } = await b2.getUploadUrl({ bucketId: bucket.bucketId });

    const rawBuffer = fs.readFileSync(rawPath);
    await b2.uploadFile({
      uploadUrl: uploadUrlData.uploadUrl,
      uploadAuthToken: uploadUrlData.authorizationToken,
      fileName: rawKey,
      data: rawBuffer,
      contentType: 'video/mp4',
    });

    console.log(`[Upload Complete] Uploaded raw file to B2: ${rawKey}`);

    // Update status to transcoding in DB
    await updateVideoRecord(videoId, { status: 'transcoding' });
    if (jobId) await updateUploadJob(jobId, { status: 'transcoding', progress_percent: 100 });

    // Trigger GitHub Actions Cloud Transcoder via GitHub API (repository_dispatch)
    const githubPat = process.env.GITHUB_PAT || process.env.GITHUB_TOKEN;
    const repoOwner = 'harrypeter07';
    const repoName  = 'getsetgo';

    if (githubPat) {
      console.log(`[Upload Complete] Triggering GitHub Actions Cloud Runner for ${videoId}...`);
      await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/dispatches`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${githubPat}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'Shimpli-Upload-API',
        },
        body: JSON.stringify({
          event_type: 'cloud_transcode',
          client_payload: { videoId, rawKey },
        }),
      });
    } else {
      console.warn(`[Upload Complete] GITHUB_PAT env var not set. Triggering background local worker fallback...`);
      // Spawn background worker as fallback
      const { spawn } = require('child_process');
      const worker = spawn('node', [path.join(process.cwd(), 'scripts', 'cloud-worker.js')], {
        env: { ...process.env, VIDEO_ID: videoId, RAW_KEY: rawKey },
        detached: true,
        stdio: 'ignore',
      });
      worker.unref();
    }

    // Cleanup temp chunk files asynchronously
    try {
      fs.rmSync(chunkDir, { recursive: true, force: true });
      fs.rmSync(rawPath, { force: true });
    } catch {}

    return NextResponse.json({
      success: true,
      videoId,
      status: 'transcoding',
      message: 'Raw file uploaded to cloud. Cloud transcoding started in background!',
    });
  } catch (err: any) {
    console.error('[Upload Complete Error]:', err);
    return NextResponse.json({ error: err.message || 'Failed to complete upload session' }, { status: 500 });
  }
}
