-- Supabase / Postgres schema for Netchinga
-- Run this in the Supabase SQL Editor

create table if not exists videos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  duration_seconds integer,
  master_manifest_url text not null default '',
  available_qualities text[] not null default '{}',        -- e.g. ['240p','360p','480p','720p']
  thumbnail_url text,
  status text not null default 'processing',   -- 'processing' | 'ready' | 'failed'
  transcode_log jsonb,                          -- stores compute env, ffmpeg version, timings
  created_at timestamptz default now(),
  view_count integer default 0
);

create table if not exists upload_jobs (
  id uuid primary key default gen_random_uuid(),
  video_id uuid references videos(id) on delete cascade,
  status text not null default 'queued',        -- 'queued' | 'transcoding' | 'uploading' | 'done' | 'error'
  error_message text,
  progress_percent integer default 0,
  updated_at timestamptz default now()
);

-- Row Level Security (optional but recommended for production)
-- alter table videos enable row level security;
-- alter table upload_jobs enable row level security;
-- create policy "Public read access" on videos for select using (true);
-- create policy "Anon insert" on videos for insert with check (true);
-- create policy "Anon update" on videos for update using (true);
-- create policy "Public read access" on upload_jobs for select using (true);
-- create policy "Anon insert" on upload_jobs for insert with check (true);
-- create policy "Anon update" on upload_jobs for update using (true);
