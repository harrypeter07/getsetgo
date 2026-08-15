/**
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║     🍿 SHIMPLI LAPTOP MEDIA SERVER  v4.0 — PRE-CHUNKED HLS       ║
 * ║                                                                   ║
 * ║  ARCHITECTURE:                                                    ║
 * ║  1. ffprobe measures exact video bitrate                          ║
 * ║  2. Segment duration calculated so each .ts ≈ 1 MB               ║
 * ║  3. ffmpeg forces keyframes at every segment boundary             ║
 * ║  4. ALL segments created BEFORE video appears to clients          ║
 * ║  5. Client hits an already-complete playlist → zero stall         ║
 * ║  6. Queue: max 2 concurrent ffmpeg jobs (CPU-friendly)            ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 */

'use strict';

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');
const { execSync, execFileSync, spawn } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

// ═══════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════
const PORT             = 4000;
const HEARTBEAT_MS     = 15_000;
const TARGET_SEG_BYTES = 1_000_000;          // 1 MB per segment target
const MIN_SEG_SECS     = 1;                  // never below 1s (too many files)
const MAX_SEG_SECS     = 4;                  // never above 4s (too big for slow links)
const MAX_CONCURRENT   = 2;                  // max parallel ffmpeg jobs
const SUPPORTED_EXTS   = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi']);

const MIME_MAP = {
  '.mp4' : 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.m4v' : 'video/mp4', '.mkv' : 'video/x-matroska', '.avi': 'video/x-msvideo',
};

// ═══════════════════════════════════════════════════════════════════
// FOLDER
// ═══════════════════════════════════════════════════════════════════
let targetFolder = process.argv[2] || (
  process.platform === 'win32' ? 'C:\\ShimpliVideos' : path.join(os.homedir(), 'ShimpliVideos')
);
if (!fs.existsSync(targetFolder)) try { fs.mkdirSync(targetFolder, { recursive: true }); } catch {}

// ═══════════════════════════════════════════════════════════════════
// SUPABASE
// ═══════════════════════════════════════════════════════════════════
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase    = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// ═══════════════════════════════════════════════════════════════════
// TEMP DIRS
// ═══════════════════════════════════════════════════════════════════
const THUMB_DIR = path.join(os.tmpdir(), 'shimpli_thumbs_v4');
const HLS_DIR   = path.join(os.tmpdir(), 'shimpli_hls_v4');
fs.mkdirSync(THUMB_DIR, { recursive: true });
fs.mkdirSync(HLS_DIR,   { recursive: true });

// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════
let localVideos   = [];
let publicBaseUrl = `http://localhost:${PORT}`;
let chunkCounter  = 0;

const activeClients = new Map();  // ip → { device, connectTime, bytesServed, chunks }

/**
 * videoState: hash → {
 *   status  : 'queued' | 'processing' | 'ready' | 'error',
 *   filePath: string,
 *   fileName: string,
 *   fileSize: number,
 *   segments: number,     // total .ts files on disk
 *   segSecs : number,     // seconds per segment
 *   bitrate : number,     // bps
 *   duration: number,     // seconds
 *   progress: number,     // 0-100
 *   error   : string | null,
 * }
 */
const videoState = new Map();

// Processing queue (FIFO, max MAX_CONCURRENT active)
const processQueue   = [];
let   activeJobs     = 0;

// ═══════════════════════════════════════════════════════════════════
// LOGGER
// ═══════════════════════════════════════════════════════════════════
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m',  green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
};
function ts()  { return new Date().toTimeString().slice(0, 8); }
function log(icon, color, label, msg) {
  console.log(`${C.dim}[${ts()}]${C.reset} ${icon} ${color}${C.bold}${label.padEnd(12)}${C.reset} ${msg}`);
}
function logBox(lines) {
  const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');
  const w = Math.max(...lines.map(l => strip(l).length)) + 4;
  console.log(`\n╔${'═'.repeat(w)}╗`);
  for (const l of lines) console.log(`║ ${l}${' '.repeat(Math.max(0, w - strip(l).length - 2))} ║`);
  console.log(`╚${'═'.repeat(w)}╝\n`);
}
function fmtBytes(b) {
  if (!b) return '0B';
  if (b < 1024)       return `${b}B`;
  if (b < 1048576)    return `${(b/1024).toFixed(1)}KB`;
  if (b < 1073741824) return `${(b/1048576).toFixed(2)}MB`;
  return `${(b/1073741824).toFixed(2)}GB`;
}
function fmtSpeed(bps) {
  if (bps < 1024)    return `${bps.toFixed(0)}B/s`;
  if (bps < 1048576) return `${(bps/1024).toFixed(1)}KB/s`;
  return `${(bps/1048576).toFixed(2)}MB/s`;
}
function fmtSecs(s) {
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s/60)}m${s%60}s`;
  return `${Math.floor(s/3600)}h${Math.floor((s%3600)/60)}m`;
}

// ═══════════════════════════════════════════════════════════════════
// DEVICE DETECTION
// ═══════════════════════════════════════════════════════════════════
function detectDevice(ua = '') {
  const l = ua.toLowerCase();
  return {
    type   : /mobile|android|iphone|ipod/.test(l) ? 'Mobile' : /ipad|tablet/.test(l) ? 'Tablet' : 'Desktop',
    os     : /windows/.test(l) ? 'Windows' : /android/.test(l) ? 'Android' : /iphone|ipad/.test(l) ? 'iOS' : /mac/.test(l) ? 'macOS' : 'Linux',
    browser: /edg\//.test(l) ? 'Edge' : /chrome/.test(l) ? 'Chrome' : /firefox/.test(l) ? 'Firefox' : /safari/.test(l) ? 'Safari' : 'Other',
  };
}

// ═══════════════════════════════════════════════════════════════════
// THUMBNAIL
// ═══════════════════════════════════════════════════════════════════
function thumbPath(fp) {
  return path.join(THUMB_DIR, `t_${crypto.createHash('md5').update(fp).digest('hex').slice(0,16)}.jpg`);
}
function genThumbAsync(fp) {
  const out = thumbPath(fp);
  if (fs.existsSync(out)) return;
  const p = spawn('ffmpeg', ['-y', '-ss', '3', '-i', fp, '-vframes', '1', '-vf', 'scale=640:-2', '-q:v', '5', out], { stdio: 'ignore' });
  p.on('error', () => {});
}

// ═══════════════════════════════════════════════════════════════════
// VIDEO PROBING  (bitrate + duration via ffprobe)
// ═══════════════════════════════════════════════════════════════════
function probeVideo(filePath) {
  try {
    const raw = execSync(
      `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`,
      { timeout: 15_000, encoding: 'utf8' }
    );
    const d   = JSON.parse(raw);
    const dur = parseFloat(d.format?.duration || '0');
    const br  = parseInt(d.format?.bit_rate   || '0', 10);
    return {
      duration: dur || 0,
      bitrate : br  || Math.round((fs.statSync(filePath).size * 8) / Math.max(dur, 30)),
    };
  } catch {
    // Estimate: assume 30s video if ffprobe not found
    const size = fs.statSync(filePath).size;
    return { duration: 0, bitrate: Math.round(size * 8 / 30) };
  }
}

/**
 * Given a video bitrate, compute segment duration so each .ts ≈ TARGET_SEG_BYTES
 *   segSecs = (TARGET_BYTES * 8) / bitrate_bps
 *   clamped to [MIN_SEG_SECS, MAX_SEG_SECS]
 */
function calcSegDuration(bitrateBps) {
  if (!bitrateBps || bitrateBps < 1000) return MAX_SEG_SECS;
  const raw = (TARGET_SEG_BYTES * 8) / bitrateBps;
  // Round to nearest 0.5s for cleaner playlist
  const rounded = Math.round(raw * 2) / 2;
  return Math.min(MAX_SEG_SECS, Math.max(MIN_SEG_SECS, rounded));
}

// ═══════════════════════════════════════════════════════════════════
// HLS PROCESSING QUEUE
// ═══════════════════════════════════════════════════════════════════
function fileHash(fp) {
  return crypto.createHash('md5').update(fp).digest('hex').slice(0, 16);
}
function hlsOutDir(fp) { return path.join(HLS_DIR, fileHash(fp)); }

/**
 * Enqueue a video for full HLS segmentation.
 * Returns immediately; processing happens in background via the queue.
 */
function enqueueHLS(video) {
  const hash = fileHash(video.filePath);
  const st   = videoState.get(hash);
  if (st && (st.status === 'processing' || st.status === 'ready')) return;

  videoState.set(hash, {
    status  : 'queued',
    filePath: video.filePath,
    fileName: video.fileName,
    fileSize: video.size,
    segments: 0,
    segSecs : MAX_SEG_SECS,
    bitrate : 0,
    duration: 0,
    progress: 0,
    error   : null,
  });

  processQueue.push(video);
  log('📋', C.cyan, 'QUEUE', `"${video.fileName}" queued (${processQueue.length} in queue, ${activeJobs} active)`);
  drainQueue();
}

function drainQueue() {
  while (processQueue.length > 0 && activeJobs < MAX_CONCURRENT) {
    const video = processQueue.shift();
    activeJobs++;
    processVideoHLS(video).finally(() => {
      activeJobs--;
      drainQueue();
    });
  }
}

/**
 * Full HLS processing for a single video.
 * Waits for ffmpeg to EXIT before resolving.
 * After this resolves, ALL segments are on disk.
 */
async function processVideoHLS(video) {
  const hash   = fileHash(video.filePath);
  const outDir = hlsOutDir(video.filePath);
  const m3u8   = path.join(outDir, 'playlist.m3u8');

  // If already done, skip
  if (videoState.get(hash)?.status === 'ready' && fs.existsSync(m3u8)) return;

  fs.mkdirSync(outDir, { recursive: true });
  videoState.set(hash, { ...videoState.get(hash), status: 'processing', progress: 0 });

  // ── Step 1: Probe ──────────────────────────────────────────────
  log('🔬', C.cyan, 'PROBE', `"${video.fileName}"`);
  const { duration, bitrate } = probeVideo(video.filePath);
  const segSecs = calcSegDuration(bitrate);
  const estSegs = duration > 0 ? Math.ceil(duration / segSecs) : '?';

  videoState.set(hash, { ...videoState.get(hash), duration, bitrate, segSecs });

  log('📐', C.yellow, 'CALC',
    `"${video.fileName}" → ` +
    `bitrate=${fmtSpeed(bitrate)} · dur=${fmtSecs(Math.round(duration))} · ` +
    `segDur=${segSecs}s · est ${estSegs} segments ≈ ${fmtBytes(TARGET_SEG_BYTES)}/seg`
  );

  // ── Step 2: ffmpeg ─────────────────────────────────────────────
  const ext         = path.extname(video.filePath).toLowerCase();
  const needsEncode = ext === '.mkv' || ext === '.avi';
  const videoCodec  = needsEncode ? 'libx264' : 'copy';
  const audioCodec  = needsEncode ? 'aac'     : 'copy';
  const encodeArgs  = needsEncode ? ['-crf', '23', '-preset', 'ultrafast', '-b:a', '128k'] : [];

  // Force keyframes every segSecs seconds — CRITICAL for copy mode so cuts happen at the right place
  // expr: insert keyframe at every segSecs-second boundary
  const keyframeExpr = `expr:gte(t,n_forced*${segSecs})`;
  const forceKFArgs  = needsEncode
    ? ['-force_key_frames', keyframeExpr]   // only works with encode
    : [];                                   // copy mode: ffmpeg already honours hls_time at keyframes

  const args = [
    '-y',
    '-i',             video.filePath,
    '-c:v',           videoCodec,
    '-c:a',           audioCodec,
    ...encodeArgs,
    ...forceKFArgs,
    '-hls_time',      String(segSecs),
    '-hls_list_size', '0',
    '-hls_flags',     'independent_segments',
    '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', path.join(outDir, 'seg_%04d.ts'),
    '-f',             'hls',
    m3u8,
  ];

  log('✂️ ', C.cyan, 'PROCESS',
    `"${video.fileName}" [${fmtBytes(video.size)}] codec=${videoCodec} segSecs=${segSecs}…`
  );

  const startMs = Date.now();

  await new Promise((resolve) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });

    let   stderr  = '';
    let   lastPct = 0;

    proc.stderr.on('data', chunk => {
      stderr += chunk.toString();

      // Parse ffmpeg progress: "time=00:01:23.45"
      const timeMatch = stderr.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (timeMatch && duration > 0) {
        const elapsed = parseInt(timeMatch[1]) * 3600 +
                        parseInt(timeMatch[2]) * 60   +
                        parseFloat(timeMatch[3]);
        const pct = Math.min(99, Math.round((elapsed / duration) * 100));

        if (pct !== lastPct) {
          lastPct = pct;
          const segsNow = (() => {
            try { return fs.readdirSync(outDir).filter(f => f.endsWith('.ts')).length; } catch { return 0; }
          })();
          videoState.set(hash, { ...videoState.get(hash), progress: pct, segments: segsNow });

          // Log every 10%
          if (pct % 10 === 0) {
            log('⏳', C.yellow, 'PROGRESS',
              `"${video.fileName}" ${pct}% · ${segsNow} segments so far`
            );
          }
        }
      }
    });

    proc.on('error', err => {
      log('⚠️ ', C.red, 'FFMPEG', `Not found: ${err.message}`);
      videoState.set(hash, { ...videoState.get(hash), status: 'error', error: 'ffmpeg not installed' });
      resolve();
    });

    proc.on('close', code => {
      const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
      const segs    = (() => {
        try { return fs.readdirSync(outDir).filter(f => f.endsWith('.ts')).length; } catch { return 0; }
      })();

      if (code === 0) {
        videoState.set(hash, {
          ...videoState.get(hash),
          status  : 'ready',
          segments: segs,
          progress: 100,
          error   : null,
        });

        const avgSegSize = segs > 0 ? Math.round(video.size / segs) : 0;
        log('✅', C.green, 'READY',
          `"${video.fileName}" → ${segs} segments · avg ${fmtBytes(avgSegSize)}/seg · took ${elapsed}s`
        );

        // Send updated heartbeat so clients see the video immediately
        sendHeartbeat();
      } else {
        // ffmpeg failed — if copy mode, retry with encode
        if (!needsEncode && code !== 0) {
          log('🔁', C.yellow, 'RETRY', `"${video.fileName}" copy failed (code ${code}), retrying with encode…`);
          videoState.set(hash, { ...videoState.get(hash), status: 'queued', progress: 0 });
          // Force encode on retry
          const video2 = { ...video, _forceEncode: true };
          processQueue.unshift(video2);   // priority: put at front
          resolve();
          drainQueue();
          return;
        }

        videoState.set(hash, { ...videoState.get(hash), status: 'error', error: `ffmpeg exit code ${code}` });
        log('⚠️ ', C.red, 'ERROR', `"${video.fileName}" failed after ${elapsed}s (code ${code})`);
        resolve();
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
// FOLDER SCANNER
// ═══════════════════════════════════════════════════════════════════
function scanVideos(dir) {
  const out = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      const fp = path.join(dir, f);
      try {
        const st = fs.statSync(fp);
        if (st.isDirectory()) {
          out.push(...scanVideos(fp));
        } else if (SUPPORTED_EXTS.has(path.extname(f).toLowerCase())) {
          genThumbAsync(fp);
          out.push({ filePath: fp, fileName: f, size: st.size });
        }
      } catch {}
    }
  } catch {}
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// SUPABASE HEARTBEAT
// ═══════════════════════════════════════════════════════════════════
async function sendHeartbeat() {
  if (!supabase) return;

  // Only expose READY videos to clients
  const readyVideos     = [];
  const processingVids  = [];

  for (const v of localVideos) {
    const hash = fileHash(v.filePath);
    const st   = videoState.get(hash);
    if (st?.status === 'ready') {
      readyVideos.push({
        name        : v.fileName,
        size        : v.size,
        hlsUrl      : `${publicBaseUrl}/hls/${hash}/playlist.m3u8`,
        streamUrl   : `${publicBaseUrl}/stream?file=${encodeURIComponent(v.filePath)}`,
        objectUrl   : `${publicBaseUrl}/hls/${hash}/playlist.m3u8`,
        thumbnailUrl: `${publicBaseUrl}/thumbnail?file=${encodeURIComponent(v.filePath)}`,
        segments    : st.segments,
        segSecs     : st.segSecs,
        duration    : st.duration,
      });
    } else if (st) {
      processingVids.push({
        name    : v.fileName,
        size    : v.size,
        status  : st.status,
        progress: st.progress,
      });
    }
  }

  const clientSnapshot = [];
  for (const [ip, info] of activeClients.entries())
    clientSnapshot.push({ ip, device: info.device, connectTime: info.connectTime, bytesServed: info.bytesServed, chunks: info.chunks });

  try {
    await supabase.from('videos').upsert({
      id                 : '00000000-0000-0000-0000-000000000000',
      title              : '__LAPTOP_SERVER_STATUS__',
      status             : 'online',
      master_manifest_url: publicBaseUrl,
      description        : JSON.stringify({
        videoCount     : localVideos.length,
        readyCount     : readyVideos.length,
        processingCount: processingVids.length,
        targetFolder,
        serverTimestamp: new Date().toISOString(),
        videos         : readyVideos,           // only ready videos for playback
        processing     : processingVids,        // processing status for UI
        activeClients  : clientSnapshot,
      }),
      created_at: new Date().toISOString(),
    });

    log('💓', C.green, 'HEARTBEAT',
      `${readyVideos.length} ready · ${processingVids.length} processing · ${clientSnapshot.length} client(s)`
    );
  } catch (err) {
    log('⚠️ ', C.yellow, 'HEARTBEAT', `Failed: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// CLOUDFLARED
// ═══════════════════════════════════════════════════════════════════
const CF_BIN = path.join(__dirname, '.cloudflared',
  process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');

async function ensureCloudflared() {
  if (fs.existsSync(CF_BIN) && fs.statSync(CF_BIN).size > 10_000_000) return CF_BIN;
  fs.mkdirSync(path.dirname(CF_BIN), { recursive: true });
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const url  = process.platform === 'win32'
    ? `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-${arch}.exe`
    : `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}`;
  log('⬇️ ', C.cyan, 'SETUP', 'Downloading cloudflared…');
  if (process.platform === 'win32')
    execSync(`powershell -NoProfile -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${CF_BIN}' -UseBasicParsing"`, { stdio: 'inherit', timeout: 180_000 });
  else {
    execSync(`curl -L --output "${CF_BIN}" "${url}"`, { stdio: 'inherit', timeout: 180_000 });
    fs.chmodSync(CF_BIN, 0o755);
  }
  return CF_BIN;
}

let tunnelProc    = null;
let tunnelRetries = 0;

async function startTunnel() {
  let bin;
  try { bin = await ensureCloudflared(); } catch { return; }

  return new Promise(resolve => {
    log('🌐', C.cyan, 'TUNNEL', 'Starting Cloudflare Quick Tunnel…');
    if (tunnelProc) try { tunnelProc.kill(); } catch {}

    tunnelProc = spawn(bin, ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolved = false;
    const parse  = data => {
      const m = data.toString().match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/i);
      if (m && !resolved) {
        resolved = true; publicBaseUrl = m[0]; tunnelRetries = 0;
        logBox([
          `${C.bold}${C.green}🌍  GLOBAL STREAM URL${C.reset}`,
          `${C.cyan}${publicBaseUrl}${C.reset}`,
          `${C.dim}Pre-chunked HLS · 1MB segments · zero client stall${C.reset}`,
        ]);
        sendHeartbeat();
        resolve(publicBaseUrl);
      }
    };
    tunnelProc.stdout.on('data', parse);
    tunnelProc.stderr.on('data', parse);
    tunnelProc.on('close', code => {
      log('⚠️ ', C.yellow, 'TUNNEL', `Closed code=${code}`);
      if (tunnelRetries < 8) {
        const d = Math.min(2000 * Math.pow(2, tunnelRetries++), 30000);
        setTimeout(startTunnel, d);
      }
      if (!resolved) resolve(null);
    });
    tunnelProc.on('error', () => { if (!resolved) { resolved = true; resolve(null); } });
    setTimeout(() => { if (!resolved) { resolved = true; resolve(null); } }, 35_000);
  });
}

// ═══════════════════════════════════════════════════════════════════
// HTTP SERVER
// ═══════════════════════════════════════════════════════════════════
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',   '*');
  res.setHeader('Access-Control-Allow-Methods',  'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',  'Range, Content-Type, bypass-tunnel-reminder');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
  res.setHeader('bypass-tunnel-reminder', 'true');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const u     = new URL(req.url, `http://localhost:${PORT}`);
  const route = u.pathname;

  // ─── /status ────────────────────────────────────────────────────
  if (route === '/status') {
    const states = [];
    for (const [hash, st] of videoState.entries())
      states.push({ hash, fileName: st.fileName, status: st.status, progress: st.progress, segments: st.segments });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ connected: true, port: PORT, targetFolder, videoCount: localVideos.length,
      publicBaseUrl, uptimeSeconds: Math.round(process.uptime()), activeJobs, queueLength: processQueue.length,
      videos: states,
      activeClients: [...activeClients.entries()].map(([ip, i]) => ({ ip, ...i })),
    }));
    return;
  }

  // ─── /thumbnail ─────────────────────────────────────────────────
  if (route === '/thumbnail') {
    const fp = u.searchParams.get('file');
    if (fp && fs.existsSync(fp)) {
      const tp = thumbPath(fp);
      if (fs.existsSync(tp)) {
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
        fs.createReadStream(tp).pipe(res); return;
      }
      genThumbAsync(fp);
    }
    res.writeHead(404); res.end(); return;
  }

  // ─── /hls/:hash/playlist.m3u8 ───────────────────────────────────
  const m3u8Match = route.match(/^\/hls\/([a-f0-9]{16})\/playlist\.m3u8$/);
  if (m3u8Match) {
    const hash = m3u8Match[1];
    const fp   = path.join(HLS_DIR, hash, 'playlist.m3u8');
    if (!fs.existsSync(fp)) { res.writeHead(404); res.end('Playlist not ready'); return; }

    // Rewrite relative segment paths → absolute tunnel URLs
    let content = fs.readFileSync(fp, 'utf8');
    content = content.replace(/(seg_\d+\.ts)/g, `${publicBaseUrl}/hls/${hash}/$1`);

    res.writeHead(200, {
      'Content-Type' : 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-cache, no-store',
    });
    res.end(content);
    log('📋', C.blue, 'PLAYLIST', `hash=${hash} served (${content.split('\n').filter(l => l.endsWith('.ts')).length} segs)`);
    return;
  }

  // ─── /hls/:hash/seg_NNNN.ts ────────────────────────────────────
  const segMatch = route.match(/^\/hls\/([a-f0-9]{16})\/(seg_\d+\.ts)$/);
  if (segMatch) {
    const [, hash, segFile] = segMatch;
    const fp    = path.join(HLS_DIR, hash, segFile);
    const clIp  = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim().replace('::ffff:', '');
    const dev   = detectDevice(req.headers['user-agent'] || '');

    if (!activeClients.has(clIp)) {
      activeClients.set(clIp, { device: `${dev.type}/${dev.os}/${dev.browser}`, connectTime: new Date().toLocaleTimeString(), bytesServed: 0, chunks: 0 });
      log('🔌', C.magenta, 'NEW CLIENT', `${C.bold}${clIp}${C.reset}  ${dev.type} | ${dev.os} | ${dev.browser}`);
    }

    if (!fs.existsSync(fp)) {
      // Segment not ready (shouldn't happen if pre-processing is complete, but guard anyway)
      res.writeHead(404, { 'Retry-After': '2' });
      res.end('Segment not found — video may still be processing');
      return;
    }

    const stat      = fs.statSync(fp);
    const segBytes  = stat.size;
    const seq       = ++chunkCounter;
    const t0        = Date.now();
    const cl        = activeClients.get(clIp);
    cl.bytesServed += segBytes;
    cl.chunks      += 1;

    const st = [...videoState.values()].find(s => path.join(HLS_DIR, hash) === hlsOutDir(s.filePath));
    const vName = st?.fileName || hash;

    res.on('finish', () => {
      const ms  = Math.max(1, Date.now() - t0);
      const bps = segBytes / (ms / 1000);
      log('📡', C.green, 'CHUNK',
        `#${seq} ${C.bold}${segFile}${C.reset} ` +
        `${C.cyan}${fmtBytes(segBytes)}${C.reset} ` +
        `${C.yellow}${ms}ms${C.reset} ` +
        `${C.bold}${C.green}${fmtSpeed(bps)}${C.reset} ` +
        `${C.magenta}${clIp}${C.reset} (${dev.type}/${dev.os}) — "${vName.slice(0, 30)}"`
      );
    });

    res.writeHead(200, {
      'Content-Type'  : 'video/mp2t',
      'Content-Length': segBytes,
      'Cache-Control' : 'public, max-age=3600, immutable',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(fp).pipe(res);
    return;
  }

  // ─── /stream  (fallback raw Range streaming) ────────────────────
  if (route === '/stream') {
    const fp = u.searchParams.get('file');
    if (!fp || !fs.existsSync(fp)) { res.writeHead(404); res.end(); return; }

    const stat     = fs.statSync(fp);
    const fileSize = stat.size;
    const mimeType = MIME_MAP[path.extname(fp).toLowerCase()] || 'video/mp4';
    const rangeHdr = req.headers.range;
    const clIp     = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim().replace('::ffff:', '');

    let start = 0, end = fileSize - 1;
    if (rangeHdr) {
      const m = rangeHdr.match(/bytes=(\d+)-(\d*)/);
      if (m) { start = parseInt(m[1], 10); end = m[2] ? parseInt(m[2], 10) : fileSize - 1; }
    }
    end = Math.min(end, fileSize - 1);
    if (start > fileSize - 1) { res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` }); res.end(); return; }

    const bytes = end - start + 1;
    const t0    = Date.now();
    res.on('finish', () => {
      const ms = Math.max(1, Date.now() - t0);
      log('📡', C.yellow, 'RAW-RANGE', `${fmtBytes(bytes)} [${start}–${end}] ${ms}ms ${fmtSpeed(bytes/(ms/1000))} ${clIp}`);
    });

    res.writeHead(206, {
      'Content-Range' : `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges' : 'bytes',
      'Content-Length': bytes,
      'Content-Type'  : mimeType,
      'Cache-Control' : 'no-cache',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(fp, { start, end }).pipe(res);
    return;
  }

  // ─── Dashboard ──────────────────────────────────────────────────
  const rows = [...videoState.entries()].map(([hash, st]) => {
    const segBar = st.progress > 0
      ? `<div style="width:100%;background:#222;height:4px;border-radius:2px;margin-top:4px"><div style="width:${st.progress}%;background:#e50914;height:4px;border-radius:2px"></div></div>`
      : '';
    return `<tr>
      <td>${st.fileName}</td>
      <td>${fmtBytes(st.fileSize)}</td>
      <td>${st.bitrate ? fmtSpeed(st.bitrate) : '—'}</td>
      <td>${st.segSecs}s ≈ ${fmtBytes(TARGET_SEG_BYTES)}</td>
      <td>${st.segments} segs</td>
      <td style="color:${st.status==='ready'?'#2ecc71':st.status==='error'?'#e74c3c':'#f39c12'}">${st.status} ${st.progress}%${segBar}</td>
      <td>${st.status==='ready'?`<a href="/hls/${hash}/playlist.m3u8" style="color:#e50914">▶ m3u8</a>`:''}</td>
    </tr>`;
  }).join('');

  const clients = [...activeClients.entries()].map(([ip, i]) =>
    `<tr><td>${ip}</td><td>${i.device}</td><td>${i.connectTime}</td><td>${fmtBytes(i.bytesServed)}</td><td>${i.chunks} chunks</td></tr>`
  ).join('');

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html><html><head><title>Shimpli v4</title>
<meta http-equiv="refresh" content="10">
<style>body{font-family:monospace;background:#0a0a0a;color:#fff;padding:2rem;max-width:1000px}
h1{color:#e50914}h2{color:#aaa;font-size:.9rem}
table{width:100%;border-collapse:collapse;margin:.5rem 0}
th{background:#1a1a1a;padding:.4rem .5rem;text-align:left;color:#e50914;font-size:.75rem}
td{padding:.35rem .5rem;border-bottom:1px solid #111;font-size:.75rem}
</style></head><body>
<h1>🍿 Shimpli v4 — Pre-Chunked HLS</h1>
<p>Folder: <code>${targetFolder}</code> | Videos: ${localVideos.length} | Uptime: ${fmtSecs(Math.round(process.uptime()))} | Queue: ${processQueue.length} | Active jobs: ${activeJobs}</p>
<p>Tunnel: <a href="${publicBaseUrl}" style="color:#e50914">${publicBaseUrl}</a></p>
<h2>📁 Video Processing (auto-refreshes every 10s)</h2>
<table><tr><th>File</th><th>Size</th><th>Bitrate</th><th>Seg Duration → Size</th><th>Segments</th><th>Status</th><th>Play</th></tr>${rows}</table>
<h2>🌐 Active Clients (${activeClients.size})</h2>
${activeClients.size === 0 ? '<p style="color:#555">None yet</p>' :
  `<table><tr><th>IP</th><th>Device</th><th>Since</th><th>Data Served</th><th>Chunks</th></tr>${clients}</table>`}
</body></html>`);
});

// ═══════════════════════════════════════════════════════════════════
// STARTUP
// ═══════════════════════════════════════════════════════════════════
server.listen(PORT, async () => {
  console.clear();
  logBox([
    `${C.bold}${C.green}🍿  SHIMPLI v4.0 — PRE-CHUNKED HLS${C.reset}`,
    `Folder  : ${C.cyan}${targetFolder}${C.reset}`,
    `Port    : ${C.yellow}${PORT}${C.reset}`,
    `Strategy: ${C.dim}ffprobe bitrate → ≈1MB segments → full pre-process → zero client stall${C.reset}`,
  ]);

  log('🔍', C.cyan, 'SCAN', `Scanning "${targetFolder}"…`);
  localVideos = scanVideos(targetFolder);
  log('✅', C.green, 'SCAN', `Found ${localVideos.length} video(s):`);
  localVideos.forEach((v, i) => log('  ', C.dim, `  ${i+1}.`, `${v.fileName} (${fmtBytes(v.size)})`));

  // Kick off pre-processing for ALL videos immediately
  log('\n✂️ ', C.cyan, 'PRE-PROC', `Starting pre-processing queue (max ${MAX_CONCURRENT} concurrent)…`);
  for (const v of localVideos) enqueueHLS(v);

  log('🚀', C.green, 'SERVER', `Local: http://localhost:${PORT}`);
  await startTunnel();
  await sendHeartbeat();
  setInterval(sendHeartbeat, HEARTBEAT_MS);

  // File watcher
  try {
    let debounce = null;
    fs.watch(targetFolder, { recursive: true }, () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        const prev = localVideos.length;
        localVideos = scanVideos(targetFolder);
        const newVids = localVideos.filter(v => {
          const h = fileHash(v.filePath);
          return !videoState.has(h) || videoState.get(h)?.status === 'error';
        });
        if (newVids.length > 0) {
          log('📂', C.green, 'WATCHER', `${newVids.length} new video(s) detected → queuing`);
          for (const v of newVids) enqueueHLS(v);
          sendHeartbeat();
        }
      }, 1000);
    });
    log('👀', C.dim, 'WATCHER', `Watching "${targetFolder}"…`);
  } catch {}
});

// ═══════════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ═══════════════════════════════════════════════════════════════════
async function shutdown(sig) {
  log('🛑', C.red, 'SHUTDOWN', sig);
  if (tunnelProc) try { tunnelProc.kill(); } catch {}
  if (supabase) {
    try {
      await supabase.from('videos').upsert({
        id: '00000000-0000-0000-0000-000000000000',
        title: '__LAPTOP_SERVER_STATUS__', status: 'offline',
        description: JSON.stringify({ videoCount: 0, videos: [], processing: [], serverTimestamp: new Date().toISOString() }),
        created_at: new Date().toISOString(),
      });
    } catch {}
  }
  process.exit(0);
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
