#!/usr/bin/env node
'use strict';

/**
 * scripts/upload-to-r2.js
 *
 * Uploads a transcoded HLS output directory to Cloudflare R2, preserving structure.
 * Sets correct Content-Type headers for .m3u8 and .ts files.
 * Uploads in parallel with a concurrency cap of 6.
 * Retries each file up to 3 times on failure.
 *
 * Usage (standalone):
 *   R2_ACCOUNT_ID=xxx R2_ACCESS_KEY_ID=yyy R2_SECRET_ACCESS_KEY=zzz \
 *   R2_BUCKET_NAME=myBucket R2_PUBLIC_URL=https://pub-xxx.r2.dev \
 *   node scripts/upload-to-r2.js <localDir> <videoId>
 */

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

// ─── R2 Client ───────────────────────────────────────────────────────────────

function createR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'Missing required R2 environment variables: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY'
    );
  }

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns correct Content-Type for HLS files.
 * @param {string} filename
 * @returns {string}
 */
function getContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.m3u8': return 'application/vnd.apple.mpegurl';
    case '.ts':   return 'video/mp2t';
    default:      return 'application/octet-stream';
  }
}

/**
 * Recursively collects all files in a directory.
 * @param {string} dir
 * @returns {string[]} absolute file paths
 */
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

/**
 * Upload a single file to R2 with retry.
 * @param {S3Client} client
 * @param {string} bucket
 * @param {string} key
 * @param {Buffer} body
 * @param {string} contentType
 * @param {number} maxRetries
 */
async function uploadWithRetry(client, bucket, key, body, contentType, maxRetries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
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

/**
 * Run async tasks with a concurrency limit.
 * @template T
 * @param {Array<() => Promise<T>>} tasks
 * @param {number} concurrency
 * @returns {Promise<T[]>}
 */
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
          if (queue.length === 0 && running.size === 0) {
            resolve(results);
          } else {
            next();
          }
        }).catch((err) => {
          reject(err);
        });
        running.add(p);
      }
    };
    next();
    if (tasks.length === 0) resolve([]);
  });
}

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * Uploads a transcoded HLS output directory to R2, preserving structure.
 * @param {string} localDir - directory containing master.m3u8 + quality subfolders
 * @param {string} videoId - used as the R2 key prefix
 * @returns {Promise<{ masterManifestUrl: string, totalBytesUploaded: number, fileCount: number }>}
 */
async function uploadHLSToR2(localDir, videoId) {
  const bucket = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL?.replace(/\/$/, '');

  if (!bucket || !publicUrl) {
    throw new Error('Missing R2_BUCKET_NAME or R2_PUBLIC_URL environment variables');
  }

  const client = createR2Client();
  const allFiles = collectFiles(localDir);

  if (allFiles.length === 0) {
    throw new Error(`No files found in directory: "${localDir}"`);
  }

  console.log(`[upload-r2] Uploading ${allFiles.length} files for video "${videoId}"...`);

  let totalBytesUploaded = 0;

  const tasks = allFiles.map((filePath) => async () => {
    const relativePath = path.relative(localDir, filePath).replace(/\\/g, '/');
    const r2Key = `${videoId}/${relativePath}`;
    const body = fs.readFileSync(filePath);
    const contentType = getContentType(filePath);

    console.log(`  → ${r2Key} (${contentType}, ${body.length} bytes)`);
    await uploadWithRetry(client, bucket, r2Key, body, contentType);
    totalBytesUploaded += body.length;
  });

  await runConcurrent(tasks, 6);

  const masterManifestUrl = `${publicUrl}/${videoId}/master.m3u8`;
  console.log(`[upload-r2] ✅ Done. Master manifest: ${masterManifestUrl}`);

  return {
    masterManifestUrl,
    totalBytesUploaded,
    fileCount: allFiles.length,
  };
}

module.exports = { uploadHLSToR2 };

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (require.main === module) {
  const [,, localDir, videoId] = process.argv;
  if (!localDir || !videoId) {
    console.error('Usage: node scripts/upload-to-r2.js <localDir> <videoId>');
    process.exit(1);
  }

  uploadHLSToR2(require('path').resolve(localDir), videoId)
    .then((result) => {
      console.log('\n✅ Upload complete:');
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      console.error('\n❌ Upload failed:', err.message);
      process.exit(1);
    });
}
