#!/usr/bin/env node
'use strict';

/**
 * scripts/upload-to-b2.js
 *
 * Uploads a transcoded HLS output directory to a PRIVATE Backblaze B2 bucket
 * using the S3-compatible API. The bucket stays private — public access goes
 * through the Cloudflare Worker proxy, not direct B2 URLs.
 *
 * Key structure: videos/{videoId}/master.m3u8
 *                videos/{videoId}/{quality}/playlist.m3u8
 *                videos/{videoId}/{quality}/seg_XXX.ts
 *
 * Usage (standalone):
 *   B2_KEY_ID=xxx B2_APPLICATION_KEY=yyy B2_BUCKET_NAME=zzz \
 *   B2_ENDPOINT=s3.us-east-005.backblazeb2.com \
 *   node scripts/upload-to-b2.js <localDir> <videoId>
 */

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

// ─── B2 S3-compatible Client ──────────────────────────────────────────────────

function createB2Client() {
  const keyId       = process.env.B2_KEY_ID;
  const appKey      = process.env.B2_APPLICATION_KEY;
  const endpoint    = process.env.B2_ENDPOINT;

  if (!keyId || !appKey || !endpoint) {
    throw new Error(
      'Missing required environment variables: B2_KEY_ID, B2_APPLICATION_KEY, B2_ENDPOINT'
    );
  }

  // Extract region from endpoint: s3.us-east-005.backblazeb2.com → us-east-005
  const region = endpoint.split('.')[1];

  return new S3Client({
    region,
    endpoint: `https://${endpoint}`,
    credentials: {
      accessKeyId: keyId,
      secretAccessKey: appKey,
    },
    // B2 requires path-style addressing (not virtual-hosted)
    forcePathStyle: true,
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.m3u8': return 'application/vnd.apple.mpegurl';
    case '.ts':   return 'video/mp2t';
    default:      return 'application/octet-stream';
  }
}

function collectFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

async function uploadWithRetry(client, bucket, key, body, contentType, maxRetries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // NOTE: Do NOT set ACL — bucket is private and B2 may error on ACL params
      }));
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`  [retry ${attempt}/${maxRetries}] Failed "${key}": ${lastError.message}`);
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
      }
    }
  }
  throw new Error(`Upload failed for "${key}" after ${maxRetries} attempts: ${lastError?.message}`);
}

async function runConcurrent(tasks, concurrency) {
  const results = [];
  const running = new Set();
  const queue = [...tasks];

  return new Promise((resolve, reject) => {
    const next = () => {
      while (running.size < concurrency && queue.length > 0) {
        const task = queue.shift();
        const p = task().then((result) => {
          results.push(result);
          running.delete(p);
          if (queue.length === 0 && running.size === 0) resolve(results);
          else next();
        }).catch(reject);
        running.add(p);
      }
    };
    next();
    if (tasks.length === 0) resolve([]);
  });
}

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * Uploads a transcoded HLS output directory to a private B2 bucket.
 * @param {string} localDir - directory containing master.m3u8 + quality subfolders
 * @param {string} videoId - used as the B2 key prefix (under videos/)
 * @returns {Promise<{ b2KeyPrefix: string, totalBytesUploaded: number, fileCount: number }>}
 */
async function uploadHLSToB2(localDir, videoId) {
  const bucket = process.env.B2_BUCKET_NAME;
  if (!bucket) throw new Error('Missing B2_BUCKET_NAME environment variable');

  const client = createB2Client();
  const allFiles = collectFiles(localDir);

  if (allFiles.length === 0) {
    throw new Error(`No files found in directory: "${localDir}"`);
  }

  const b2KeyPrefix = `videos/${videoId}`;
  console.log(`[upload-b2] Uploading ${allFiles.length} files to B2 prefix "${b2KeyPrefix}"...`);

  let totalBytesUploaded = 0;

  const tasks = allFiles.map((filePath) => async () => {
    const relativePath = path.relative(localDir, filePath).replace(/\\/g, '/');
    const b2Key = `${b2KeyPrefix}/${relativePath}`;
    const body = fs.readFileSync(filePath);
    const contentType = getContentType(filePath);

    console.log(`  → ${b2Key} (${contentType}, ${body.length} bytes)`);
    await uploadWithRetry(client, bucket, b2Key, body, contentType);
    totalBytesUploaded += body.length;
  });

  await runConcurrent(tasks, 6);

  console.log(`[upload-b2] ✅ Done. ${allFiles.length} files, ${(totalBytesUploaded / 1024 / 1024).toFixed(1)} MB uploaded.`);
  console.log(`[upload-b2] B2 key prefix: ${b2KeyPrefix}`);
  console.log(`[upload-b2] ⚠️  Bucket is PRIVATE — stream via Cloudflare Worker proxy only`);

  return {
    b2KeyPrefix,
    totalBytesUploaded,
    fileCount: allFiles.length,
  };
}

module.exports = { uploadHLSToB2 };

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (require.main === module) {
  const [,, localDir, videoId] = process.argv;
  if (!localDir || !videoId) {
    console.error('Usage: node scripts/upload-to-b2.js <localDir> <videoId>');
    process.exit(1);
  }

  uploadHLSToB2(require('path').resolve(localDir), videoId)
    .then((result) => {
      console.log('\n✅ Upload complete:');
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      console.error('\n❌ Upload failed:', err.message);
      process.exit(1);
    });
}
