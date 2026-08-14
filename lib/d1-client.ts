/**
 * lib/d1-client.ts
 *
 * Replaces Supabase. Talks to Cloudflare D1 via the REST API.
 * All calls are server-side only — credentials never reach the browser.
 *
 * D1 REST API: POST /accounts/{account_id}/d1/database/{db_id}/query
 */

import type { Video, UploadJob } from './types';

// ─── D1 REST API helpers ──────────────────────────────────────────────────────

const D1_BASE = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${process.env.CLOUDFLARE_D1_DATABASE_ID}`;

interface D1Result {
  results: Record<string, unknown>[];
  success: boolean;
  errors?: { message: string }[];
}

async function d1Query(sql: string, params: unknown[] = []): Promise<D1Result> {
  const token = process.env.CLOUDFLARE_D1_TOKEN;
  if (!token) throw new Error('CLOUDFLARE_D1_TOKEN is not set');

  const res = await fetch(`${D1_BASE}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params }),
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`D1 HTTP ${res.status}: ${text}`);
  }

  const json = await res.json() as { result: D1Result[]; success: boolean; errors?: { message: string }[] };

  if (!json.success) {
    throw new Error(`D1 error: ${JSON.stringify(json.errors)}`);
  }

  return json.result[0];
}

// ─── Row → Domain model mappers ───────────────────────────────────────────────

function rowToVideo(row: Record<string, unknown>): Video {
  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string | null) ?? undefined,
    duration_seconds: (row.duration_seconds as number | null) ?? undefined,
    master_manifest_url: row.master_manifest_url as string,
    available_qualities: JSON.parse((row.available_qualities as string) || '[]') as string[],
    thumbnail_url: (row.thumbnail_url as string | null) ?? undefined,
    status: row.status as 'processing' | 'ready' | 'failed',
    transcode_log: row.transcode_log ? JSON.parse(row.transcode_log as string) : undefined,
    created_at: row.created_at as string,
    view_count: (row.view_count as number) ?? 0,
  };
}

function rowToJob(row: Record<string, unknown>): UploadJob {
  return {
    id: row.id as string,
    video_id: row.video_id as string,
    status: row.status as UploadJob['status'],
    error_message: (row.error_message as string | null) ?? undefined,
    progress_percent: (row.progress_percent as number) ?? 0,
    updated_at: row.updated_at as string,
  };
}

// ─── Video helpers ────────────────────────────────────────────────────────────

export async function createVideoRecord(
  id: string,
  title: string,
  description?: string
): Promise<Video> {
  await d1Query(
    `INSERT INTO videos (id, title, description, status, master_manifest_url, available_qualities)
     VALUES (?, ?, ?, 'processing', '', '[]')`,
    [id, title, description ?? null]
  );
  const result = await d1Query('SELECT * FROM videos WHERE id = ?', [id]);
  return rowToVideo(result.results[0]);
}

export async function getVideoById(id: string): Promise<Video | null> {
  const result = await d1Query('SELECT * FROM videos WHERE id = ?', [id]);
  if (!result.results.length) return null;
  return rowToVideo(result.results[0]);
}

export async function listVideos(limit = 24): Promise<Video[]> {
  const result = await d1Query(
    `SELECT * FROM videos WHERE status = 'ready' ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
  return result.results.map(rowToVideo);
}

export async function updateVideoRecord(
  id: string,
  update: Partial<{
    status: string;
    master_manifest_url: string;
    available_qualities: string[];
    duration_seconds: number;
    thumbnail_url: string;
    transcode_log: unknown;
  }>
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (update.status !== undefined)              { sets.push('status = ?');               values.push(update.status); }
  if (update.master_manifest_url !== undefined) { sets.push('master_manifest_url = ?');  values.push(update.master_manifest_url); }
  if (update.available_qualities !== undefined) { sets.push('available_qualities = ?');   values.push(JSON.stringify(update.available_qualities)); }
  if (update.duration_seconds !== undefined)    { sets.push('duration_seconds = ?');      values.push(update.duration_seconds); }
  if (update.thumbnail_url !== undefined)       { sets.push('thumbnail_url = ?');         values.push(update.thumbnail_url); }
  if (update.transcode_log !== undefined)       { sets.push('transcode_log = ?');         values.push(JSON.stringify(update.transcode_log)); }

  if (!sets.length) return;

  values.push(id);
  await d1Query(`UPDATE videos SET ${sets.join(', ')} WHERE id = ?`, values);
}

// ─── Upload Job helpers ───────────────────────────────────────────────────────

export async function createUploadJob(jobId: string, videoId: string): Promise<UploadJob> {
  await d1Query(
    `INSERT INTO upload_jobs (id, video_id, status, progress_percent) VALUES (?, ?, 'queued', 0)`,
    [jobId, videoId]
  );
  const result = await d1Query('SELECT * FROM upload_jobs WHERE id = ?', [jobId]);
  return rowToJob(result.results[0]);
}

export async function getUploadJob(jobId: string): Promise<UploadJob | null> {
  const result = await d1Query('SELECT * FROM upload_jobs WHERE id = ?', [jobId]);
  if (!result.results.length) return null;
  return rowToJob(result.results[0]);
}

export async function updateUploadJob(
  jobId: string,
  update: Partial<{
    status: string;
    error_message: string;
    progress_percent: number;
  }>
): Promise<void> {
  const sets: string[] = ["updated_at = datetime('now')"];
  const values: unknown[] = [];

  if (update.status !== undefined)         { sets.push('status = ?');          values.push(update.status); }
  if (update.error_message !== undefined)  { sets.push('error_message = ?');   values.push(update.error_message); }
  if (update.progress_percent !== undefined) { sets.push('progress_percent = ?'); values.push(update.progress_percent); }

  values.push(jobId);
  await d1Query(`UPDATE upload_jobs SET ${sets.join(', ')} WHERE id = ?`, values);
}
