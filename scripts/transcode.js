#!/usr/bin/env node
'use strict';

/**
 * scripts/transcode.js
 *
 * Transcodes a source video into multi-quality HLS output using FFmpeg.
 * Detects source resolution, ALL audio streams (Hindi, English, Korean, etc.),
 * and extracts ALL subtitle streams into WebVTT HLS tracks.
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
 * Detects source video dimensions, duration, audio streams, and subtitle streams using ffprobe.
 * @param {string} inputPath
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

  const audioStreams = (info.streams || [])
    .filter((s) => s.codec_type === 'audio')
    .map((s, idx) => ({
      index: s.index,
      audioIndex: idx,
      lang: s.tags?.language || s.tags?.LANG || 'und',
      title: s.tags?.title || s.tags?.handler_name || `Audio ${idx + 1}`,
    }));

  const subtitleStreams = (info.streams || [])
    .filter((s) => s.codec_type === 'subtitle')
    .map((s, idx) => ({
      index: s.index,
      subIndex: idx,
      codec: s.codec_name,
      lang: s.tags?.language || s.tags?.LANG || `sub${idx + 1}`,
      title: s.tags?.title || s.tags?.handler_name || `Subtitle ${idx + 1}`,
    }));

  if (!width || !height) {
    throw new Error(`Could not determine video dimensions from "${inputPath}"`);
  }

  return { width, height, duration, audioStreams, subtitleStreams };
}

/**
 * Gets the installed ffmpeg version string.
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
 */
function detectEnvironment() {
  if (process.env.CI || process.env.GITHUB_ACTIONS || process.env.CIRCLECI) return 'ci';
  if (process.env.AWS_EXECUTION_ENV || process.env.GOOGLE_CLOUD_PROJECT || process.env.AZURE_FUNCTIONS_ENVIRONMENT) return 'cloud';
  return 'local';
}

/**
 * Extracts embedded subtitle streams into WebVTT files.
 * @param {string} inputPath
 * @param {string} outputDir
 * @param {Array<{ index: number, subIndex: number, lang: string, title: string }>} subtitleStreams
 */
async function extractSubtitles(inputPath, outputDir, subtitleStreams = []) {
  if (!subtitleStreams || subtitleStreams.length === 0) return [];

  const subsDir = path.join(outputDir, 'subs');
  fs.mkdirSync(subsDir, { recursive: true });

  const subResults = [];

  for (const s of subtitleStreams) {
    const lang = s.lang || `sub${s.subIndex + 1}`;
    const vttFilename = `sub_${lang}_${s.subIndex}.vtt`;
    const vttPath = path.join(subsDir, vttFilename);

    try {
      await execFileAsync('ffmpeg', [
        '-y',
        '-i', inputPath,
        '-map', `0:${s.index}`,
        '-c:s', 'webvtt',
        vttPath,
      ]);
      subResults.push({
        index: s.index,
        subIndex: s.subIndex,
        lang: s.lang,
        title: s.title,
        vttRelativePath: `subs/${vttFilename}`,
      });
      console.log(`[transcode] ✅ Extracted Subtitle [${s.title || s.lang}] -> subs/${vttFilename}`);
    } catch (err) {
      console.warn(`[transcode] ⚠️ Could not extract subtitle stream 0:${s.index}:`, err.message);
    }
  }

  return subResults;
}

/**
 * Transcodes one quality level using FFmpeg.
 */
function transcodeQuality(inputPath, outputDir, quality, audioStreams = [], useGPU = true) {
  const qualityDir = path.join(outputDir, quality.label);
  fs.mkdirSync(qualityDir, { recursive: true });

  const segmentFilename = path.join(qualityDir, 'seg_%03d.ts');
  const playlistPath = path.join(qualityDir, 'playlist.m3u8');

  // Build audio mapping args dynamically for all audio streams
  const audioMapArgs = [];
  if (audioStreams.length > 0) {
    audioStreams.forEach((a, i) => {
      audioMapArgs.push('-map', `0:${a.index}`);
      audioMapArgs.push(`-c:a:${i}`, 'aac', `-ar:${i}`, '48000', `-b:a:${i}`, '128k');
    });
  } else {
    audioMapArgs.push('-map', '0:a?');
    audioMapArgs.push('-c:a', 'aac', '-ar', '48000', '-b:a', '128k');
  }

  // ── AMD AMF GPU args (h264_amf) ───────────────────────────────────────────
  const gpuArgs = [
    '-i', inputPath,
    '-map', '0:v:0',
    ...audioMapArgs,
    '-vf', `scale=w=-2:h=${quality.height}`,
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
    '-map', '0:v:0',
    ...audioMapArgs,
    '-vf', `scale=w=-2:h=${quality.height}`,
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
    console.log(`[transcode] [${quality.label}] Using ${encoderName} with ${audioStreams.length} audio track(s)`);
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      const lines = chunk.toString().split('\r');
      const progressLine = lines.find(l => l.includes('time=') && l.includes('speed='));
      if (progressLine) process.stdout.write(`\r[${quality.label}] ${progressLine.trim().slice(0, 80)}`);
    });

    proc.on('close', (code) => {
      process.stdout.write('\n');
      if (code !== 0) {
        if (useGPU && (stderr.includes('Cannot load') || stderr.includes('Error') || stderr.includes('failed'))) {
          console.warn(`[transcode] [${quality.label}] GPU encoder failed, falling back to CPU...`);
          transcodeQuality(inputPath, outputDir, quality, audioStreams, false).then(resolve).catch(reject);
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
 * Writes the HLS master manifest referencing quality variants, audio streams, and WebVTT subtitles.
 */
function writeMasterManifest(outputDir, qualities, audioStreams = [], subtitleResults = []) {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];

  // Add WebVTT subtitle media declarations
  if (subtitleResults.length > 0) {
    subtitleResults.forEach((s, i) => {
      const isDefault = i === 0 ? 'YES' : 'NO';
      lines.push(`#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="${s.title || s.lang}",DEFAULT=${isDefault},AUTOSELECT=YES,LANGUAGE="${s.lang}",URI="${s.vttRelativePath}"`);
    });
  }

  // Add audio media declarations if multi-audio
  if (audioStreams.length > 1) {
    audioStreams.forEach((a, i) => {
      const isDefault = i === 0 ? 'YES' : 'NO';
      lines.push(`#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="${a.title || a.lang}",DEFAULT=${isDefault},AUTOSELECT=YES,LANGUAGE="${a.lang}",URI="${qualities[0].label}/playlist.m3u8"`);
    });
  }

  for (const q of qualities) {
    const bandwidth = q.bitrateKbps * 1000;
    const audioGroupAttr = audioStreams.length > 1 ? ',AUDIO="audio"' : '';
    const subGroupAttr = subtitleResults.length > 0 ? ',SUBTITLES="subs"' : '';
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${q.width}x${q.height},NAME="${q.label}"${audioGroupAttr}${subGroupAttr}`);
    lines.push(`${q.label}/playlist.m3u8`);
  }

  const masterPath = path.join(outputDir, 'master.m3u8');
  fs.writeFileSync(masterPath, lines.join('\n') + '\n', 'utf8');
  return masterPath;
}

// ─── Main Export ─────────────────────────────────────────────────────────────

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
  console.log(`[transcode] Audio Streams Found (${sourceInfo.audioStreams.length}):`, sourceInfo.audioStreams);
  console.log(`[transcode] Subtitle Streams Found (${sourceInfo.subtitleStreams.length}):`, sourceInfo.subtitleStreams);
  console.log(`[transcode] FFmpeg version: ${ffmpegVersion}`);

  // Extract WebVTT subtitles first
  const subtitleResults = await extractSubtitles(inputPath, outputDir, sourceInfo.subtitleStreams);

  const eligibleQualities = [...QUALITY_LADDER];

  console.log(`[transcode] Generating ${eligibleQualities.length} qualities IN PARALLEL: ${eligibleQualities.map((q) => q.label).join(', ')}`);

  await Promise.all(
    eligibleQualities.map(async (quality) => {
      console.log(`[transcode] ⚡ Started: ${quality.label}`);
      await transcodeQuality(inputPath, outputDir, quality, sourceInfo.audioStreams);
      console.log(`[transcode] ✅ Done:    ${quality.label}`);
    })
  );

  const masterManifestPath = writeMasterManifest(outputDir, eligibleQualities, sourceInfo.audioStreams, subtitleResults);
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
