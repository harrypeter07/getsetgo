#!/usr/bin/env node
'use strict';

/**
 * scripts/cloud-worker.js
 *
 * Executed inside GitHub Actions Cloud Runner.
 * 1. Downloads raw video from B2 (raw/<videoId>.mp4)
 * 2. Transcodes to HLS (360p, 480p, 720p, Multi-Audio, WebVTT Subs) using scripts/transcode.js
 * 3. Uploads transcoded HLS files to B2 (videos/<videoId>/...)
 * 4. Updates Supabase DB record status to 'ready'
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const B2 = require('backblaze-b2');
const { createClient } = require('@supabase/supabase-js');
const { transcodeToHLS } = require('./transcode');

const videoId = process.env.VIDEO_ID;
const rawKey  = process.env.RAW_KEY || `raw/${videoId}.mp4`;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const b2KeyId   = process.env.B2_APPLICATION_KEY_ID;
const b2AppKey  = process.env.B2_APPLICATION_KEY;
const b2Bucket  = process.env.B2_BUCKET_NAME;

if (!videoId) {
  console.error('❌ Missing VIDEO_ID environment variable');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const b2 = new B2({ applicationKeyId: b2KeyId, applicationKey: b2AppKey });

async function getBucketId() {
  const { data } = await b2.listBuckets();
  const bucket = data.buckets.find(b => b.bucketName === b2Bucket);
  if (!bucket) throw new Error(`Bucket "${b2Bucket}" not found`);
  return bucket.bucketId;
}

async function uploadDirectoryToB2(bucketId, localDir, b2Prefix) {
  const files = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  }

  walk(localDir);
  console.log(`[cloud-worker] Uploading ${files.length} HLS files to B2 under prefix: ${b2Prefix}`);

  const { data: uploadUrlData } = await b2.getUploadUrl({ bucketId });

  let uploadedCount = 0;
  const totalFiles = files.length;

  for (const file of files) {
    const relPath = path.relative(localDir, file).replace(/\\/g, '/');
    const fileName = `${b2Prefix}/${relPath}`;
    const fileData = fs.readFileSync(file);

    let contentType = 'application/octet-stream';
    if (fileName.endsWith('.m3u8')) contentType = 'application/x-mpegURL';
    else if (fileName.endsWith('.ts')) contentType = 'video/MP2T';
    else if (fileName.endsWith('.vtt')) contentType = 'text/vtt';

    let retries = 3;
    let success = false;

    while (retries > 0 && !success) {
      try {
        await b2.uploadFile({
          uploadUrl: uploadUrlData.uploadUrl,
          uploadAuthToken: uploadUrlData.authorizationToken,
          fileName,
          data: fileData,
          contentType,
        });
        success = true;
      } catch (err) {
        retries--;
        if (retries === 0) throw err;
        await new Promise(res => setTimeout(res, 1000));
      }
    }

    uploadedCount++;
    if (uploadedCount % 20 === 0 || uploadedCount === totalFiles) {
      console.log(`[cloud-worker] Uploaded ${uploadedCount}/${totalFiles} files to B2`);
    }
  }
}

async function run() {
  console.log(`🚀 Starting Cloud Transcode Worker for Video ID: ${videoId}`);
  const tmpDir = path.join(os.tmpdir(), `cloud-hls-${videoId}`);
  const rawPath = path.join(tmpDir, 'input.mp4');
  const hlsOutDir = path.join(tmpDir, 'hls');

  fs.mkdirSync(hlsOutDir, { recursive: true });

  try {
    // Update status to transcoding in DB
    await supabase.from('videos').update({ status: 'transcoding' }).eq('id', videoId);

    // Authorize B2
    await b2.authorize();
    const bucketId = await getBucketId();

    console.log(`[cloud-worker] Downloading raw video from B2: ${rawKey}`);
    const downloadRes = await b2.downloadFileByName({ bucketName: b2Bucket, fileName: rawKey, responseType: 'arraybuffer' });
    fs.writeFileSync(rawPath, Buffer.from(downloadRes.data));

    console.log(`[cloud-worker] Transcoding raw video with FFmpeg...`);
    const result = await transcodeToHLS(rawPath, hlsOutDir);

    console.log(`[cloud-worker] Transcode complete! Uploading HLS output to B2...`);
    const b2Prefix = `videos/${videoId}`;
    await uploadDirectoryToB2(bucketId, hlsOutDir, b2Prefix);

    // Update Supabase video record
    const qualities = result.qualities.map(q => q.label);
    await supabase.from('videos').update({
      master_manifest_url: b2Prefix,
      available_qualities: qualities,
      duration_seconds: result.durationSeconds,
      status: 'ready',
      transcode_log: {
        ...result,
        completedBy: 'github-actions-cloud',
        completedAt: new Date().toISOString(),
      },
    }).eq('id', videoId);

    console.log(`✅ Cloud Transcode Worker completed successfully for Video ID: ${videoId}`);
  } catch (err) {
    console.error(`❌ Cloud Transcode Worker failed:`, err);
    await supabase.from('videos').update({
      status: 'failed',
      transcode_log: { error: err.message, failedAt: new Date().toISOString() },
    }).eq('id', videoId);
    process.exit(1);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

run();
