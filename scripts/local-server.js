/**
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║       🍿 SHIMPLI LAPTOP MEDIA SERVER  v3.0 — HLS EDITION         ║
 * ║  Cloudflare Quick Tunnel • HLS Segmented Streaming               ║
 * ║  Client Analytics • ffmpeg HLS • 2-3GB File Support              ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 *
 *  How it works:
 *  1. When a video is first requested, ffmpeg remuxes it (copy codec, no re-encode)
 *     into 4-second .ts segments + an .m3u8 playlist — takes 5-30s for large files.
 *  2. The first segment is ready in ~2s, so playback starts almost instantly.
 *  3. The frontend uses hls.js to fetch segments one at a time via the tunnel.
 *  4. Each segment is only 0.5-3 MB → reliable on any connection, no buffering stall.
 */

'use strict';

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');
const { createClient }    = require('@supabase/supabase-js');

require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

// ═══════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════
const PORT           = 4000;
const HEARTBEAT_MS   = 15_000;
const HLS_SEG_SECS   = 4;          // 4-second segments (sweet spot: 2-8 MB each)
const SUPPORTED_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi']);

const MIME_MAP = {
  '.mp4' : 'video/mp4',
  '.webm': 'video/webm',
  '.mov' : 'video/quicktime',
  '.m4v' : 'video/mp4',
  '.mkv' : 'video/x-matroska',
  '.avi' : 'video/x-msvideo',
};

// ═══════════════════════════════════════════════════════════════════
// FOLDER SETUP
// ═══════════════════════════════════════════════════════════════════
let targetFolder = process.argv[2] || (
  process.platform === 'win32'
    ? path.join('C:', 'ShimpliVideos')
    : path.join(os.homedir(), 'ShimpliVideos')
);
if (!fs.existsSync(targetFolder)) {
  try { fs.mkdirSync(targetFolder, { recursive: true }); } catch {}
}

// ═══════════════════════════════════════════════════════════════════
// SUPABASE
// ═══════════════════════════════════════════════════════════════════
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase    = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// ═══════════════════════════════════════════════════════════════════
// TEMP DIRS
// ═══════════════════════════════════════════════════════════════════
const THUMB_DIR = path.join(os.tmpdir(), 'shimpli_thumbs_v3');
const HLS_DIR   = path.join(os.tmpdir(), 'shimpli_hls_v3');
fs.mkdirSync(THUMB_DIR, { recursive: true });
fs.mkdirSync(HLS_DIR,   { recursive: true });

// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════
let localVideos   = [];
let publicBaseUrl = `http://localhost:${PORT}`;
let chunkCounter  = 0;

// Client tracking: ip → { device, connectTime, bytesServed, chunks }
const activeClients = new Map();

// HLS status per file hash: 'processing' | 'ready' | 'error'
const hlsStatus = new Map();

// ═══════════════════════════════════════════════════════════════════
// LOGGER
// ═══════════════════════════════════════════════════════════════════
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
};

function ts() { return new Date().toTimeString().slice(0, 8); }

function log(icon, color, label, msg) {
  console.log(`${C.dim}[${ts()}]${C.reset} ${icon} ${color}${C.bold}${label.padEnd(12)}${C.reset} ${msg}`);
}

function logBox(lines) {
  const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');
  const width = Math.max(...lines.map(l => strip(l).length)) + 4;
  console.log(`\n╔${'═'.repeat(width)}╗`);
  for (const l of lines) {
    const pad = width - strip(l).length - 2;
    console.log(`║ ${l}${' '.repeat(Math.max(0, pad))} ║`);
  }
  console.log(`╚${'═'.repeat(width)}╝\n`);
}

function fmtBytes(b) {
  if (b < 1024)            return `${b}B`;
  if (b < 1048576)         return `${(b / 1024).toFixed(1)}KB`;
  if (b < 1073741824)      return `${(b / 1048576).toFixed(2)}MB`;
  return `${(b / 1073741824).toFixed(2)}GB`;
}

function fmtSpeed(bps) {
  if (bps < 1024)    return `${bps.toFixed(0)}B/s`;
  if (bps < 1048576) return `${(bps / 1024).toFixed(1)}KB/s`;
  return `${(bps / 1048576).toFixed(2)}MB/s`;
}

// ═══════════════════════════════════════════════════════════════════
// DEVICE DETECTION
// ═══════════════════════════════════════════════════════════════════
function detectDevice(ua = '') {
  const l = ua.toLowerCase();
  const type    = /mobile|android|iphone|ipod/.test(l) ? 'Mobile'
                : /ipad|tablet/.test(l)                 ? 'Tablet'
                : 'Desktop';
  const osName  = /windows/.test(l)      ? 'Windows'
                : /android/.test(l)      ? 'Android'
                : /iphone|ipad/.test(l)  ? 'iOS'
                : /mac os/.test(l)       ? 'macOS'
                : /linux/.test(l)        ? 'Linux'
                : 'Unknown';
  const browser = /edg\//.test(l)        ? 'Edge'
                : /chrome/.test(l)       ? 'Chrome'
                : /firefox/.test(l)      ? 'Firefox'
                : /safari/.test(l)       ? 'Safari'
                : 'Unknown';
  return { type, os: osName, browser };
}

// ═══════════════════════════════════════════════════════════════════
// THUMBNAIL (async fire-and-forget)
// ═══════════════════════════════════════════════════════════════════
function thumbPath(filePath) {
  const h = crypto.createHash('md5').update(filePath).digest('hex').slice(0, 16);
  return path.join(THUMB_DIR, `t_${h}.jpg`);
}

function genThumbAsync(filePath) {
  const out = thumbPath(filePath);
  if (fs.existsSync(out)) return;
  const p = spawn('ffmpeg', ['-y', '-ss', '3', '-i', filePath, '-vframes', '1', '-vf', 'scale=640:-2', '-q:v', '5', out], { stdio: 'ignore' });
  p.on('error', () => {});
}

// ═══════════════════════════════════════════════════════════════════
// HLS SEGMENTATION
// ═══════════════════════════════════════════════════════════════════
function fileHash(filePath) {
  return crypto.createHash('md5').update(filePath).digest('hex').slice(0, 16);
}

function hlsDir(filePath) {
  return path.join(HLS_DIR, fileHash(filePath));
}

/**
 * Starts ffmpeg segmentation for a file (non-blocking).
 * Returns immediately; segmentation runs in background.
 * Status tracked in hlsStatus map.
 */
function startHLS(filePath) {
  const hash   = fileHash(filePath);
  const outDir = hlsDir(filePath);
  const m3u8   = path.join(outDir, 'playlist.m3u8');

  if (hlsStatus.get(hash) === 'ready'      && fs.existsSync(m3u8)) return 'ready';
  if (hlsStatus.get(hash) === 'processing')                         return 'processing';

  fs.mkdirSync(outDir, { recursive: true });
  hlsStatus.set(hash, 'processing');

  const ext = path.extname(filePath).toLowerCase();
  // For MKV/AVI: try copy first, fall back to transcode if needed
  const videoCodec = (ext === '.mkv' || ext === '.avi') ? 'libx264' : 'copy';
  const audioCodec = (ext === '.mkv' || ext === '.avi') ? 'aac'     : 'copy';
  const extraArgs  = (ext === '.mkv' || ext === '.avi')
    ? ['-crf', '23', '-preset', 'ultrafast', '-b:a', '128k']
    : [];

  const args = [
    '-y',
    '-i', filePath,
    '-c:v', videoCodec,
    '-c:a', audioCodec,
    ...extraArgs,
    '-hls_time',          String(HLS_SEG_SECS),
    '-hls_list_size',     '0',                // keep ALL segments in playlist
    '-hls_flags',         'independent_segments',
    '-hls_segment_type',  'mpegts',
    '-hls_segment_filename', path.join(outDir, 'seg_%04d.ts'),
    '-f',                 'hls',
    m3u8,
  ];

  log('✂️ ', C.cyan, 'HLS', `Segmenting "${path.basename(filePath)}" (${fmtBytes(fs.statSync(filePath).size)}) codec=${videoCodec}…`);

  const proc = spawn('ffmpeg', args, { stdio: 'ignore' });

  proc.on('close', code => {
    if (code === 0) {
      const segs = fs.readdirSync(outDir).filter(f => f.endsWith('.ts')).length;
      hlsStatus.set(hash, 'ready');
      log('✅', C.green, 'HLS', `"${path.basename(filePath)}" → ${segs} segments ready`);
    } else {
      // transcode failed — mark error
      hlsStatus.set(hash, 'error');
      log('⚠️ ', C.red, 'HLS', `ffmpeg exited code=${code} for "${path.basename(filePath)}"`);
    }
  });

  proc.on('error', () => {
    hlsStatus.set(hash, 'error');
    log('⚠️ ', C.red, 'HLS', 'ffmpeg not found — install ffmpeg for HLS support');
  });

  return 'processing';
}

/**
 * Wait until at least `minSegments` .ts files exist (or timeout).
 */
function waitForSegments(outDir, minSegments, timeoutMs) {
  return new Promise(resolve => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      try {
        const count = fs.readdirSync(outDir).filter(f => f.endsWith('.ts')).length;
        if (count >= minSegments) return resolve(true);
      } catch {}
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(check, 250);
    };
    check();
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
  const now = new Date().toISOString();

  // Snapshot active clients for the heartbeat
  const clientSnapshot = [];
  for (const [ip, info] of activeClients.entries()) {
    clientSnapshot.push({
      ip,
      device     : info.device,
      connectTime: info.connectTime,
      bytesServed: info.bytesServed,
      chunks     : info.chunks,
    });
  }

  try {
    await supabase.from('videos').upsert({
      id                 : '00000000-0000-0000-0000-000000000000',
      title              : '__LAPTOP_SERVER_STATUS__',
      status             : 'online',
      master_manifest_url: publicBaseUrl,
      description        : JSON.stringify({
        videoCount     : localVideos.length,
        targetFolder,
        serverTimestamp: now,
        activeClients  : clientSnapshot,
        videos         : localVideos.map(v => ({
          name        : v.fileName,
          size        : v.size,
          objectUrl   : `${publicBaseUrl}/hls-init?file=${encodeURIComponent(v.filePath)}`,
          hlsUrl      : `${publicBaseUrl}/hls-init?file=${encodeURIComponent(v.filePath)}`,
          streamUrl   : `${publicBaseUrl}/stream?file=${encodeURIComponent(v.filePath)}`,
          thumbnailUrl: `${publicBaseUrl}/thumbnail?file=${encodeURIComponent(v.filePath)}`,
        })),
      }),
      created_at: now,
    });
    log('💓', C.green, 'HEARTBEAT',
      `${localVideos.length} video(s) · ${clientSnapshot.length} client(s) → DB updated`);
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
  const arch  = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const url   = process.platform === 'win32'
    ? `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-${arch}.exe`
    : `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}`;
  log('⬇️ ', C.cyan, 'SETUP', 'Downloading cloudflared…');
  if (process.platform === 'win32') {
    execSync(`powershell -NoProfile -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${CF_BIN}' -UseBasicParsing"`, { stdio: 'inherit', timeout: 180_000 });
  } else {
    execSync(`curl -L --output "${CF_BIN}" "${url}"`, { stdio: 'inherit', timeout: 180_000 });
    fs.chmodSync(CF_BIN, 0o755);
  }
  return CF_BIN;
}

let tunnelProc   = null;
let tunnelRetries = 0;

async function startTunnel() {
  let bin;
  try { bin = await ensureCloudflared(); }
  catch { return; }

  return new Promise(resolve => {
    log('🌐', C.cyan, 'TUNNEL', 'Starting Cloudflare Quick Tunnel…');
    if (tunnelProc) { try { tunnelProc.kill(); } catch {} }

    tunnelProc = spawn(bin, ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolved = false;
    const parse = data => {
      const m = data.toString().match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/i);
      if (m && !resolved) {
        resolved = true; publicBaseUrl = m[0]; tunnelRetries = 0;
        logBox([
          `${C.bold}${C.green}🌍  GLOBAL STREAM URL${C.reset}`,
          `${C.cyan}${publicBaseUrl}${C.reset}`,
          `${C.dim}HLS Streaming • No interstitial • CDN-backed${C.reset}`,
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
        const delay = Math.min(2000 * Math.pow(2, tunnelRetries++), 30000);
        log('🔄', C.cyan, 'TUNNEL', `Retry in ${Math.round(delay / 1000)}s…`);
        setTimeout(startTunnel, delay);
      }
      if (!resolved) resolve(null);
    });

    tunnelProc.on('error', err => {
      if (!resolved) { resolved = true; resolve(null); }
    });

    setTimeout(() => { if (!resolved) { resolved = true; resolve(null); } }, 35_000);
  });
}

// ═══════════════════════════════════════════════════════════════════
// HTTP SERVER
// ═══════════════════════════════════════════════════════════════════
const server = http.createServer(async (req, res) => {
  // CORS — critical for hls.js cross-origin requests
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
    const clients = [];
    for (const [ip, i] of activeClients.entries())
      clients.push({ ip, device: i.device, since: i.connectTime, bytes: i.bytesServed, chunks: i.chunks });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ connected: true, port: PORT, targetFolder, videoCount: localVideos.length, publicBaseUrl, uptimeSeconds: Math.round(process.uptime()), activeClients: clients }));
    return;
  }

  // ─── /list ──────────────────────────────────────────────────────
  if (route === '/list') {
    localVideos = scanVideos(targetFolder);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(localVideos.map(v => ({
      name        : v.fileName, size: v.size,
      hlsUrl      : `${publicBaseUrl}/hls-init?file=${encodeURIComponent(v.filePath)}`,
      streamUrl   : `${publicBaseUrl}/stream?file=${encodeURIComponent(v.filePath)}`,
      thumbnailUrl: `${publicBaseUrl}/thumbnail?file=${encodeURIComponent(v.filePath)}`,
    }))));
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

  // ─── /hls-init?file=<path> ──────────────────────────────────────
  // Kick off HLS segmentation and redirect to playlist once first segment ready
  if (route === '/hls-init') {
    const fp = u.searchParams.get('file');
    if (!fp || !fs.existsSync(fp)) { res.writeHead(404); res.end('File not found'); return; }

    const hash   = fileHash(fp);
    const outDir = hlsDir(fp);
    const m3u8   = path.join(outDir, 'playlist.m3u8');

    // Start segmentation if not already running
    startHLS(fp);

    // Wait up to 12 seconds for first segment to be ready
    log('⏳', C.yellow, 'HLS-INIT', `Waiting for first segment of "${path.basename(fp)}"…`);
    const ready = await waitForSegments(outDir, 1, 12_000);

    if (!ready) {
      // Not ready yet — return a retry-after response
      res.writeHead(503, { 'Retry-After': '3', 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'HLS segmentation in progress, retry in 3s', status: hlsStatus.get(hash) }));
      return;
    }

    // Redirect to the playlist — this is what hls.js fetches
    const playlistUrl = `/hls/${hash}/playlist.m3u8`;
    res.writeHead(302, { 'Location': playlistUrl, 'Cache-Control': 'no-store' });
    res.end();
    return;
  }

  // ─── /hls/:hash/playlist.m3u8 ───────────────────────────────────
  // Serve the HLS playlist file
  const hlsPlaylistMatch = route.match(/^\/hls\/([a-f0-9]{16})\/playlist\.m3u8$/);
  if (hlsPlaylistMatch) {
    const hash   = hlsPlaylistMatch[1];
    const fp     = path.join(HLS_DIR, hash, 'playlist.m3u8');
    if (!fs.existsSync(fp)) { res.writeHead(404); res.end(); return; }

    // Read and rewrite segment URLs to absolute Cloudflare tunnel URLs
    // (so hls.js on mobile can fetch them directly from the tunnel)
    let content = fs.readFileSync(fp, 'utf8');
    // Replace relative seg_NNNN.ts with absolute tunnel URLs
    content = content.replace(/(seg_\d+\.ts)/g, `${publicBaseUrl}/hls/${hash}/$1`);

    res.writeHead(200, {
      'Content-Type' : 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-cache, no-store',   // always fresh — playlist grows as ffmpeg writes
    });
    res.end(content);

    log('📋', C.blue, 'HLS', `Served playlist for hash=${hash}`);
    return;
  }

  // ─── /hls/:hash/seg_NNNN.ts ────────────────────────────────────
  // Serve a .ts segment — these are the actual video chunks
  const hlsSegMatch = route.match(/^\/hls\/([a-f0-9]{16})\/(seg_\d+\.ts)$/);
  if (hlsSegMatch) {
    const [, hash, segFile] = hlsSegMatch;
    const fp = path.join(HLS_DIR, hash, segFile);

    // Client info for logging
    const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')
                       .split(',')[0].trim().replace('::ffff:', '');
    const ua       = req.headers['user-agent'] || '';
    const dev      = detectDevice(ua);

    if (!activeClients.has(clientIp)) {
      activeClients.set(clientIp, { device: `${dev.type}/${dev.os}/${dev.browser}`, connectTime: new Date().toLocaleTimeString(), bytesServed: 0, chunks: 0 });
      log('🔌', C.magenta, 'NEW CLIENT', `${C.bold}${clientIp}${C.reset}  ${dev.type} | ${dev.os} | ${dev.browser}`);
    }

    if (!fs.existsSync(fp)) {
      // Segment not generated yet (playback is ahead of segmentation)
      // Wait up to 8 seconds for it
      const appeared = await waitForSegments(path.dirname(fp), parseInt(segFile.replace('seg_', '').replace('.ts', '')) + 1, 8_000);
      if (!appeared || !fs.existsSync(fp)) {
        res.writeHead(404); res.end('Segment not ready yet'); return;
      }
    }

    const stat      = fs.statSync(fp);
    const segBytes  = stat.size;
    const seqNum    = ++chunkCounter;
    const t0        = Date.now();
    const client    = activeClients.get(clientIp);
    client.bytesServed += segBytes;
    client.chunks      += 1;

    res.on('finish', () => {
      const ms  = Math.max(1, Date.now() - t0);
      const bps = segBytes / (ms / 1000);
      log('📡', C.green, 'HLS-SEG',
        `#${seqNum} ${segFile} ${C.bold}${fmtBytes(segBytes)}${C.reset} ` +
        `${C.yellow}${ms}ms${C.reset} ` +
        `${C.bold}${C.green}${fmtSpeed(bps)}${C.reset} ` +
        `${C.magenta}${clientIp}${C.reset} (${dev.type}/${dev.os})`
      );
    });

    res.writeHead(200, {
      'Content-Type'  : 'video/mp2t',
      'Content-Length': segBytes,
      'Cache-Control' : 'public, max-age=3600, immutable',   // segments are immutable
    });

    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(fp).pipe(res);
    return;
  }

  // ─── /stream  (fallback direct range streaming) ─────────────────
  if (route === '/stream') {
    const fp = u.searchParams.get('file');
    if (!fp || !fs.existsSync(fp)) { res.writeHead(404); res.end(); return; }

    const stat     = fs.statSync(fp);
    const fileSize = stat.size;
    const mimeType = MIME_MAP[path.extname(fp).toLowerCase()] || 'video/mp4';
    const rangeHdr = req.headers.range;
    const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim().replace('::ffff:', '');
    const dev      = detectDevice(req.headers['user-agent'] || '');

    if (!activeClients.has(clientIp)) {
      activeClients.set(clientIp, { device: `${dev.type}/${dev.os}/${dev.browser}`, connectTime: new Date().toLocaleTimeString(), bytesServed: 0, chunks: 0 });
      log('🔌', C.magenta, 'NEW CLIENT', `${clientIp}  ${dev.type}|${dev.os}|${dev.browser} [DIRECT]`);
    }

    let start = 0;
    let end   = fileSize - 1;

    if (rangeHdr) {
      const m = rangeHdr.match(/bytes=(\d+)-(\d*)/);
      if (m) { start = parseInt(m[1], 10); end = m[2] ? parseInt(m[2], 10) : fileSize - 1; }
    }

    end = Math.min(end, fileSize - 1);
    if (start > fileSize - 1) { res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` }); res.end(); return; }

    const bytes = end - start + 1;
    const seq   = ++chunkCounter;
    const t0    = Date.now();
    const cl    = activeClients.get(clientIp);
    cl.bytesServed += bytes; cl.chunks += 1;

    res.on('finish', () => {
      const ms  = Math.max(1, Date.now() - t0);
      log('📡', C.yellow, 'STREAM',
        `#${seq} "${path.basename(fp).slice(0,30)}" ${fmtBytes(bytes)} [${start}–${end}] ${ms}ms ${fmtSpeed(bytes / (ms / 1000))} ${clientIp}`
      );
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
  const clients = [...activeClients.entries()].map(([ip, i]) =>
    `<tr><td>${ip}</td><td>${i.device}</td><td>${i.connectTime}</td><td>${fmtBytes(i.bytesServed)}</td><td>${i.chunks}</td></tr>`
  ).join('');

  const hlsList = localVideos.map(v => {
    const h      = fileHash(v.filePath);
    const status = hlsStatus.get(h) || 'not started';
    const segs   = (() => { try { return fs.readdirSync(hlsDir(v.filePath)).filter(f => f.endsWith('.ts')).length; } catch { return 0; } })();
    return `<tr><td>${v.fileName}</td><td>${fmtBytes(v.size)}</td><td>${status} (${segs} segs)</td><td><a href="/hls-init?file=${encodeURIComponent(v.filePath)}" style="color:#e50914">▶ HLS</a></td></tr>`;
  }).join('');

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html><html><head><title>Shimpli v3</title>
<style>body{font-family:monospace;background:#0a0a0a;color:#fff;padding:2rem;max-width:900px}
h1{color:#e50914}h2{color:#aaa;font-size:1rem}
table{width:100%;border-collapse:collapse;margin:.5rem 0}
th{background:#222;padding:.4rem .5rem;text-align:left;color:#e50914;font-size:.8rem}
td{padding:.35rem .5rem;border-bottom:1px solid #1a1a1a;font-size:.8rem}</style></head><body>
<h1>🍿 Shimpli Laptop Media Server v3 — HLS</h1>
<p>Folder: <code>${targetFolder}</code> &nbsp;|&nbsp; Videos: <b>${localVideos.length}</b> &nbsp;|&nbsp; Uptime: ${Math.round(process.uptime())}s</p>
<p>Tunnel: <a href="${publicBaseUrl}" style="color:#e50914">${publicBaseUrl}</a></p>
<h2>📁 Videos</h2>
<table><tr><th>File</th><th>Size</th><th>HLS Status</th><th>Play</th></tr>${hlsList}</table>
<h2>🌐 Active Clients</h2>
${activeClients.size === 0 ? '<p style="color:#666">None yet</p>' :
`<table><tr><th>IP</th><th>Device</th><th>Since</th><th>Data</th><th>Chunks</th></tr>${clients}</table>`}
</body></html>`);
});

// ═══════════════════════════════════════════════════════════════════
// STARTUP
// ═══════════════════════════════════════════════════════════════════
server.listen(PORT, async () => {
  console.clear();
  logBox([
    `${C.bold}${C.green}🍿  SHIMPLI LAPTOP MEDIA SERVER  v3.0 — HLS${C.reset}`,
    `Folder : ${C.cyan}${targetFolder}${C.reset}`,
    `Port   : ${C.yellow}${PORT}${C.reset}`,
    `${C.dim}HLS segments → reliable streaming on any connection${C.reset}`,
  ]);

  log('🔍', C.cyan, 'SCAN', `Scanning "${targetFolder}"…`);
  localVideos = scanVideos(targetFolder);
  log('✅', C.green, 'SCAN', `Found ${localVideos.length} video(s):`);
  localVideos.forEach((v, i) => {
    log('  ', C.dim, `  ${i + 1}.`, `${v.fileName}  (${fmtBytes(v.size)})`);
  });

  // Start HLS pre-segmentation for all videos immediately
  log('✂️ ', C.cyan, 'HLS', 'Pre-segmenting all videos in background…');
  for (const v of localVideos) startHLS(v.filePath);

  log('🚀', C.green, 'SERVER', `Local: http://localhost:${PORT}`);
  await startTunnel();
  await sendHeartbeat();
  setInterval(sendHeartbeat, HEARTBEAT_MS);

  // Folder watcher
  try {
    let debounce = null;
    fs.watch(targetFolder, { recursive: true }, () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        const prev = localVideos.length;
        localVideos = scanVideos(targetFolder);
        if (localVideos.length !== prev) {
          log('📂', C.green, 'WATCHER', `Library updated: ${localVideos.length} video(s)`);
          // Segment new videos
          for (const v of localVideos) startHLS(v.filePath);
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
  if (tunnelProc) { try { tunnelProc.kill(); } catch {} }
  if (supabase) {
    try {
      await supabase.from('videos').upsert({
        id: '00000000-0000-0000-0000-000000000000',
        title: '__LAPTOP_SERVER_STATUS__', status: 'offline',
        description: JSON.stringify({ videoCount: 0, videos: [], serverTimestamp: new Date().toISOString() }),
        created_at: new Date().toISOString(),
      });
    } catch {}
  }
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
