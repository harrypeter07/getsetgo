import { createClient } from '@supabase/supabase-js';
import type { Video, UploadJob } from './types';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
// Server-side: use service role key (bypasses RLS, never exposed to browser)
// Client-side: falls back to anon key
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY 
  ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    '[supabase-client] Missing Supabase env vars. ' +
    'Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local'
  );
}

export const supabase = createClient(supabaseUrl ?? 'http://localhost', supabaseKey ?? 'placeholder');

// ─── Videos ────────────────────────────────────────────────────────────────

export async function createVideoRecord(data: {
  title: string;
  master_manifest_url: string;
  available_qualities: string[];
}): Promise<Video> {
  const { data: video, error } = await supabase
    .from('videos')
    .insert({
      title: data.title,
      master_manifest_url: data.master_manifest_url,
      available_qualities: data.available_qualities,
      status: 'processing',
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create video record: ${error.message}`);
  return video as Video;
}

export async function updateVideoRecord(
  id: string,
  data: Partial<Pick<Video, 'status' | 'duration_seconds' | 'master_manifest_url' | 'available_qualities' | 'transcode_log' | 'thumbnail_url'>>
): Promise<void> {
  const { error } = await supabase
    .from('videos')
    .update(data)
    .eq('id', id);

  if (error) throw new Error(`Failed to update video ${id}: ${error.message}`);
}

export async function getVideoById(id: string): Promise<Video | null> {
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // not found
    throw new Error(`Failed to fetch video ${id}: ${error.message}`);
  }
  return data as Video;
}

export async function listVideos(limit = 20): Promise<Video[]> {
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .eq('status', 'ready')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[supabase-client] listVideos error:', error);
    throw new Error(`Failed to list videos: ${error.message} (code: ${error.code})`);
  }
  return (data ?? []) as Video[];
}

// ─── Upload Jobs ────────────────────────────────────────────────────────────

export async function createUploadJob(videoId: string): Promise<UploadJob> {
  const { data: job, error } = await supabase
    .from('upload_jobs')
    .insert({
      video_id: videoId,
      status: 'queued',
      progress_percent: 0,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create upload job: ${error.message}`);
  return job as UploadJob;
}

export async function updateUploadJob(
  jobId: string,
  data: Partial<Pick<UploadJob, 'status' | 'progress_percent' | 'error_message'>>
): Promise<void> {
  const { error } = await supabase
    .from('upload_jobs')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', jobId);

  if (error) throw new Error(`Failed to update job ${jobId}: ${error.message}`);
}

export async function getUploadJob(jobId: string): Promise<UploadJob | null> {
  const { data, error } = await supabase
    .from('upload_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to fetch job ${jobId}: ${error.message}`);
  }
  return data as UploadJob;
}
