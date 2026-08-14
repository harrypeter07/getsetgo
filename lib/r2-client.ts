import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import path from 'path';

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID!;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID!;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY!;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME!;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL!; // e.g. https://pub-xxxx.r2.dev

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME || !R2_PUBLIC_URL) {
  console.warn(
    '[r2-client] Missing one or more R2 environment variables. ' +
    'Upload operations will fail. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL in .env.local'
  );
}

export const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID ?? 'placeholder'}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID ?? 'placeholder',
    secretAccessKey: R2_SECRET_ACCESS_KEY ?? 'placeholder',
  },
});

/**
 * Upload a single file buffer to R2.
 * Retries up to 3 times on failure.
 */
export async function uploadFileToR2(
  key: string,
  body: Buffer,
  contentType: string,
  maxRetries = 3
): Promise<void> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await r2Client.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: key,
          Body: body,
          ContentType: contentType,
        })
      );
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[r2-client] Upload attempt ${attempt}/${maxRetries} failed for key "${key}": ${lastError.message}`);
      if (attempt < maxRetries) {
        // exponential backoff: 500ms, 1000ms, 2000ms
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
      }
    }
  }
  throw new Error(`Failed to upload "${key}" after ${maxRetries} attempts: ${lastError?.message}`);
}

/**
 * Returns the public URL for an R2 object by key.
 */
export function getPublicUrl(key: string): string {
  return `${R2_PUBLIC_URL?.replace(/\/$/, '')}/${key}`;
}

/**
 * Determines the correct Content-Type for HLS files.
 */
export function getContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.m3u8': return 'application/vnd.apple.mpegurl';
    case '.ts':   return 'video/mp2t';
    default:      return 'application/octet-stream';
  }
}
