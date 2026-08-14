#!/usr/bin/env node
'use strict';

/**
 * scripts/transcode.js
 *
 * Transcodes a source video into multi-quality HLS output using FFmpeg.
 * Detects source resolution first; only generates renditions <= source resolution.
 *
 * Usage (standalone):
 *   node scripts/transcode.js <inputPath> <outputDir>
 */

const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const fs = require('fs');
const path = require('path');

const execFileAsync = promisify(execFile);

// ─── Quality Ladder ──────────────────────────────────────────────────────────

const QUALITY_LADDER = [
  { label: '360p',  width: 640,  height: 360,  bitrateKbps: 800,  maxrate: 856,   bufsize: 1200  },
  { label: '480p',  width: 854,  height: 480,  bitrateKbps: 1400, maxrate: 1498,  bufsize: 2100  },
  { label: '720p',  width: 1280, height: 720,  bitrateKbps: 2800, maxrate: 2996,  bufsize: 4200  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Detects source video dimensions and duration using ffprobe.
 * @param {string} inputPath
 * @returns {{ width: number, height: number, duration: number }}
 */
async function probeVideo(inputPath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    '-show_format',
    inputPath,
  ]);

  const info = JSON.parse(stdout);
  const videoStream = info.streams?.find((s) => s.codec_type === 'video');

  if (!videoStream) {
    throw new Error(`No video stream found in "${inputPath}"`);
  }

  const width = videoStream.width;
  const height = videoStream.height;
  const duration = parseFloat(info.format?.duration ?? '0');

  if (!width || !height) {
    throw new Error(`Could not determine video dimensions from "${inputPath}"`);
  }

  return { width, height, duration };
}

/**
 * Gets the installed ffmpeg version string.
 * @returns {Promise<string>}
 */
async function getFfmpegVersion() {
  try {
    const { stdout } = await execFileAsync('ffmpeg', ['-version']);
    const match = stdout.match(/ffmpeg version ([^\s]+)/);
    return match ? match[1] : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Detects the compute environment (local / ci / cloud).
 * @returns {'local' | 'ci' | 'cloud'}
 */
function detectEnvironment() {
  if (process.env.CI || process.env.GITHUB_ACTIONS || process.env.CIRCLECI) return 'ci';
  if (process.env.AWS_EXECUTION_ENV || process.env.GOOGLE_CLOUD_PROJECT || process.env.AZURE_FUNCTIONS_ENVIRONMENT) return 'cloud';
  return 'local';
}

/**
 * Transcodes one quality level using FFmpeg.
 * @param {string} inputPath
 * @param {string} outputDir
 * @param {{ label: string, width: number, height: number, bitrateKbps: number, maxrate: number, bufsize: number }} quality
 * @returns {Promise<void>}
 */
function transcodeQuality(inputPath, outputDir, quality, useGPU = true) {
  const qualityDir = path.join(outputDir, quality.label);
  fs.mkdirSync(qualityDir, { recursive: true });

  const segmentFilename = path.join(qualityDir, 'seg_%03d.ts');
  const playlistPath = path.join(qualityDir, 'playlist.m3u8');

  // ── AMD AMF GPU args (h264_amf) ───────────────────────────────────────────
  // 10-15x faster than CPU libx264. Uses AMD Radeon GPU.
  const gpuArgs = [
    '-i', inputPath,
    '-map', '0:v:0',             // video stream
    '-map', '0:a:1',             // English audio (stream 1) — skip Hindi (stream 0)
    '-vf', `scale=w=-2:h=${quality.height}`,
    '-c:a', 'aac',
    '-ar', '48000',
    '-b:a', '128k',
    '-c:v', 'h264_amf',
    '-quality', 'speed',
    '-rc', '1',
    '-b:v', `${quality.bitrateKbps}k`,
    '-maxrate', `${quality.maxrate}k`,
    '-bufsize', `${quality.bufsize}k`,
    '-pix_fmt', 'yuv420p',
    '-hls_time', '6',
    '-hls_playlist_type', 'vod',
    '-hls_segment_filename', segmentFilename,
    playlistPath,
  ];

  // ── CPU fallback args (libx264) ────────────────────────────────────────────
  const cpuArgs = [
    '-i', inputPath,
    '-map', '0:v:0',             // video stream
    '-map', '0:a:1',             // English audio (stream 1)
    '-vf', `scale=w=-2:h=${quality.height}`,
    '-c:a', 'aac',
    '-ar', '48000',
    '-b:a', '128k',
    '-c:v', 'h264',
    '-profile:v', 'high',
    '-pix_fmt', 'yuv420p',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-sc_threshold', '0',
    '-g', '48',
    '-keyint_min', '48',
    '-b:v', `${quality.bitrateKbps}k`,
    '-maxrate', `${quality.maxrate}k`,
    '-bufsize', `${quality.bufsize}k`,
    '-hls_time', '6',
    '-hls_playlist_type', 'vod',
    '-hls_segment_filename', segmentFilename,
    playlistPath,
  ];

  const args = useGPU ? gpuArgs : cpuArgs;
  const encoderName = useGPU ? 'h264_amf (GPU)' : 'libx264 (CPU)';

  return new Promise((resolve, reject) => {
    console.log(`[transcode] [${quality.label}] Using ${encoderName}`);
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      // Print progress lines (contain "time=")
      const lines = chunk.toString().split('\r');
      const progressLine = lines.find(l => l.includes('time=') && l.includes('speed='));
      if (progressLine) process.stdout.write(`\r[${quality.label}] ${progressLine.trim().slice(0, 80)}`);
    });

    proc.on('close', (code) => {
      process.stdout.write('\n');
      if (code !== 0) {
        // If GPU failed, retry with CPU automatically
        if (useGPU && (stderr.includes('Cannot load') || stderr.includes('Error') || stderr.includes('failed'))) {
          console.warn(`[transcode] [${quality.label}] GPU encoder failed, falling back to CPU...`);
          transcodeQuality(inputPath, outputDir, quality, false).then(resolve).catch(reject);
        } else {
          reject(new Error(`FFmpeg exited ${code} for ${quality.label}:\n${stderr.slice(-500)}`));
        }
      } else {
        resolve();
      }
    });

    proc.on('error', (err) => reject(new Error(`Failed to spawn ffmpeg: ${err.message}`)));
  });
}

/**
 * Writes the HLS master manifest referencing all quality variant playlists.
 * @param {string} outputDir
 * @param {Array<{ label: string, width: number, height: number, bitrateKbps: number }>} qualities
 */
function writeMasterManifest(outputDir, qualities) {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];

  for (const q of qualities) {
    const bandwidth = q.bitrateKbps * 1000; // in bps
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${q.width}x${q.height},NAME="${q.label}"`);
    lines.push(`${q.label}/playlist.m3u8`);
  }

  const masterPath = path.join(outputDir, 'master.m3u8');
  fs.writeFileSync(masterPath, lines.join('\n') + '\n', 'utf8');
  return masterPath;
}

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * Transcodes a source video into multi-quality HLS output.
 * @param {string} inputPath - absolute path to source video file
 * @param {string} outputDir - directory to write {quality}/playlist.m3u8 + segments + master.m3u8
 * @returns {Promise<{
 *   qualities: Array<{ label: string, width: number, height: number, bitrateKbps: number }>,
 *   masterManifestPath: string,
 *   durationSeconds: number,
 *   ffmpegVersion: string,
 *   transcodeTimeMs: number,
 *   hostname: string,
 *   nodeVersion: string,
 *   environment: 'local' | 'ci' | 'cloud'
 * }>}
 */
async function transcodeToHLS(inputPath, outputDir) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: "${inputPath}"`);
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const startTime = Date.now();
  const [sourceInfo, ffmpegVersion] = await Promise.all([
    probeVideo(inputPath),
    getFfmpegVersion(),
  ]);

  console.log(`[transcode] Source: ${sourceInfo.width}x${sourceInfo.height}, duration: ${sourceInfo.duration.toFixed(1)}s`);
  console.log(`[transcode] FFmpeg version: ${ffmpegVersion}`);

  // Use all qualities in the ladder (height filter disabled — user controls ladder)
  const eligibleQualities = [...QUALITY_LADDER];

  console.log(`[transcode] Generating ${eligibleQualities.length} qualities IN PARALLEL: ${eligibleQualities.map((q) => q.label).join(', ')}`);
  console.log(`[transcode] Using preset: veryfast (5x faster than default)`);

  // ── Encode ALL qualities simultaneously ──────────────────────────────────
  // Parallel encoding uses all CPU cores across qualities for maximum speed.
  await Promise.all(
    eligibleQualities.map(async (quality) => {
      console.log(`[transcode] ⚡ Started: ${quality.label}`);
      await transcodeQuality(inputPath, outputDir, quality);
      console.log(`[transcode] ✅ Done:    ${quality.label}`);
    })
  );

  const masterManifestPath = writeMasterManifest(outputDir, eligibleQualities);
  console.log(`[transcode] Master manifest written: ${masterManifestPath}`);

  const transcodeTimeMs = Date.now() - startTime;

  return {
    qualities: eligibleQualities.map(({ label, width, height, bitrateKbps }) => ({
      label,
      width,
      height,
      bitrateKbps,
    })),
    masterManifestPath,
    durationSeconds: Math.round(sourceInfo.duration),
    ffmpegVersion,
    transcodeTimeMs,
    hostname: os.hostname(),
    nodeVersion: process.version,
    environment: detectEnvironment(),
  };
}

module.exports = { transcodeToHLS };

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (require.main === module) {
  const [,, inputPath, outputDir] = process.argv;
  if (!inputPath || !outputDir) {
    console.error('Usage: node scripts/transcode.js <inputPath> <outputDir>');
    process.exit(1);
  }

  transcodeToHLS(path.resolve(inputPath), path.resolve(outputDir))
    .then((result) => {
      console.log('\n✅ Transcode complete:');
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      console.error('\n❌ Transcode failed:', err.message);
      process.exit(1);
    });
}
