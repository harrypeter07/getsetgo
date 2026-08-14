#!/usr/bin/env node
'use strict';

const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres.brvqjtmkeemyfccslcdp:Hassania@1122@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false },
});

const SQL = `
CREATE TABLE IF NOT EXISTS videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  duration_seconds integer,
  master_manifest_url text NOT NULL DEFAULT '',
  available_qualities text[] NOT NULL DEFAULT '{}',
  thumbnail_url text,
  status text NOT NULL DEFAULT 'processing',
  transcode_log jsonb,
  created_at timestamptz DEFAULT now(),
  view_count integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS upload_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid REFERENCES videos(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued',
  error_message text,
  progress_percent integer DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);
`;

async function main() {
  console.log('Connecting to Supabase via pooler...');
  await client.connect();
  console.log('Connected! Creating tables...');
  await client.query(SQL);
  await client.end();
  console.log('✅ Schema created successfully! Tables: videos, upload_jobs');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
