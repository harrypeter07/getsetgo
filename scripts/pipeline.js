#!/usr/bin/env node
'use strict';

/**
 * scripts/pipeline.js
 *
 * Full end-to-end pipeline for a single video:
 *   1. Create a video record in Supabase (status=processing)
 *   2. Transcode to HLS (FFmpeg)
 *   3. Upload all segments to B2
 *   4. Update Supabase record to status=ready
 *
 * Usage:
 *   node scripts/pipeline.js <videoFilePath> "<title>"
 *
 * Example:
 *   node scripts/pipeline.js "./video.mkv" "If Wishes Could Kill 2026"
 */

const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');

// Load .env.local
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const B2_KEY_ID    = process.env.B2_KEY_ID;
const B2_APP_KEY   = process.env.B2_APPLICATION_KEY;
const B2_BUCKET    = process.env.B2_BUCKET_NAME;
const B2_ENDPOINT  = process.env.B2_ENDPOINT;
const STREAM_BASE  = process.env.NEXT_PUBLIC_STREAM_BASE_URL;

// Validate environment
const missing = [];
if (!SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL');
if (!SERVICE_KEY)  missing.push('SUPABASE_SERVICE_ROLE_KEY');
if (!B2_KEY_ID)    missing.push('B2_KEY_ID');
if (!B2_APP_KEY)   missing.push('B2_APPLICATION_KEY');
if (!B2_BUCKET)    missing.push('B2_BUCKET_NAME');
if (!B2_ENDPOINT)  missing.push('B2_ENDPOINT');
if (missing.length) {
  console.error('❌ Missing env vars:', missing.join(', '));
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toLocaleTimeString('en-GB');
  console.log(`[${ts}] ${msg}`);
}

function formatBytes(bytes) {
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ─── Supabase helpers ─────────────────────────────────────────────────────────

async function createVideoRecord(id, title) {
  const { data, error } = await supabase
    .from('videos')
    .insert({ id, title, status: 'processing', master_manifest_url: '', available_qualities: [] })
    .select()
    .single();
  if (error) throw new Error(`Supabase insert failed: ${error.message}`);
  return data;
}

async function updateVideoRecord(id, update) {
  const { error } = await supabase.from('videos').update(update).eq('id', id);
  if (error) throw new Error(`Supabase update failed: ${error.message}`);
}

async function markFailed(id, reason) {
  try {
    await supabase.from('videos').update({ status: 'failed', transcode_log: { error: reason } }).eq('id', id);
  } catch {}
}

// ─── Main Pipeline ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: node scripts/pipeline.js <videoFilePath> [title]');
    process.exit(1);
  }

  const inputPath = path.resolve(args[0]);
  const title = args[1] ?? path.basename(inputPath, path.extname(inputPath));
  const videoId = randomUUID();
  const outputDir = path.join(os.tmpdir(), `netchinga-hls-${videoId}`);

  log(`🎬 Starting pipeline for: "${title}"`);
  log(`   Input:    ${inputPath}`);
  log(`   VideoID:  ${videoId}`);
  log(`   HLS dir:  ${outputDir}`);
  log(`   B2 dest:  ${B2_BUCKET}/videos/${videoId}/`);
  console.log('');

  // ── Step 1: Create DB record ──────────────────────────────────────────────
  log('📝 Step 1/4 — Creating video record in Supabase...');
  try {
    await createVideoRecord(videoId, title);
    log('   ✅ Record created (status=processing)');
  } catch (err) {
    console.error('❌ Failed to create DB record:', err.message);
    console.error('   → Make sure you ran the schema SQL in the Supabase SQL Editor first!');
    process.exit(1);
  }

  // ── Step 2: Transcode ─────────────────────────────────────────────────────
  log(`\n⚙️  Step 2/4 — Transcoding to HLS (this takes a while for large files)...`);
  log(`   Quality ladder: 240p → 360p → 480p → 720p → 1080p`);
  log(`   Estimated time: 20-60 min for a 2-3GB file on CPU`);

  const transcodeStart = Date.now();
  let transcodeResult;

  try {
    const { transcodeToHLS } = require('./transcode.js');
    transcodeResult = await transcodeToHLS(inputPath, outputDir);
    const elapsed = formatDuration(Date.now() - transcodeStart);
    log(`   ✅ Transcode done in ${elapsed}`);
    log(`   Qualities: ${transcodeResult.qualities.map(q => q.label).join(', ')}`);
    log(`   Duration:  ${transcodeResult.durationSeconds}s`);
  } catch (err) {
    log(`❌ Transcode failed: ${err.message}`);
    await markFailed(videoId, err.message);
    process.exit(1);
  }

  // ── Step 3: Upload to B2 ──────────────────────────────────────────────────
  log(`\n☁️  Step 3/4 — Uploading HLS segments to B2...`);

  const uploadStart = Date.now();
  let uploadResult;

  try {
    const { uploadHLSToB2 } = require('./upload-to-b2.js');
    uploadResult = await uploadHLSToB2(outputDir, videoId);
    const elapsed = formatDuration(Date.now() - uploadStart);
    log(`   ✅ Upload done in ${elapsed}`);
    log(`   Files:  ${uploadResult.fileCount}`);
    log(`   Size:   ${formatBytes(uploadResult.totalBytesUploaded)}`);
    log(`   Prefix: ${uploadResult.b2KeyPrefix}`);
  } catch (err) {
    log(`❌ Upload failed: ${err.message}`);
    await markFailed(videoId, `Upload failed: ${err.message}`);
    process.exit(1);
  }

  // ── Step 4: Update Supabase ───────────────────────────────────────────────
  log(`\n💾 Step 4/4 — Updating Supabase record to ready...`);

  const b2KeyPrefix = uploadResult.b2KeyPrefix; // e.g. "videos/{videoId}"
  const workerPath = b2KeyPrefix.replace(/^videos\//, '/video/');
  const masterManifestUrl = `${STREAM_BASE}${workerPath}/master.m3u8`;

  try {
    await updateVideoRecord(videoId, {
      status: 'ready',
      master_manifest_url: uploadResult.b2KeyPrefix,  // store as key prefix, URL constructed at request time
      available_qualities: transcodeResult.qualities.map(q => q.label),
      duration_seconds: transcodeResult.durationSeconds,
      transcode_log: {
        ...transcodeResult,
        fileCount: uploadResult.fileCount,
        totalBytesUploaded: uploadResult.totalBytesUploaded,
        pipelineCompletedAt: new Date().toISOString(),
      },
    });
    log(`   ✅ Record updated (status=ready)`);
  } catch (err) {
    log(`❌ Supabase update failed: ${err.message}`);
    process.exit(1);
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  const totalTime = formatDuration(Date.now() - transcodeStart);
  console.log('\n' + '═'.repeat(60));
  log(`✅ PIPELINE COMPLETE in ${totalTime}`);
  console.log('═'.repeat(60));
  console.log(`\n  Video ID:    ${videoId}`);
  console.log(`  Title:       ${title}`);
  console.log(`  Qualities:   ${transcodeResult.qualities.map(q => q.label).join(', ')}`);
  console.log(`  Stream URL:  ${masterManifestUrl}`);
  console.log(`  Watch page:  http://localhost:3000/watch/${videoId}`);
  console.log('');
}

main().catch((err) => {
  console.error('\n❌ Unhandled pipeline error:', err.message);
  process.exit(1);
});
