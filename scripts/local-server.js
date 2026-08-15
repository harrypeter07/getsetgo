/**
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║       🍿 SHIMPLI LAPTOP MEDIA SERVER  v2.0                       ║
 * ║  Cloudflare Quick Tunnel • True HTTP Range Streaming              ║
 * ║  Client Analytics • Structured Logs • 2-3GB File Support         ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 */

'use strict';

const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const crypto  = require('crypto');
const { execSync, spawn } = require('child_process');
const { createClient }    = require('@supabase/supabase-js');

require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

// ═══════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════
const PORT           = 4000;
const HEARTBEAT_MS   = 15_000;          // Supabase heartbeat every 15s
const SUPPORTED_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi']);

// MIME types — MKV/AVI need special handling
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
// THUMBNAIL CACHE
// ═══════════════════════════════════════════════════════════════════
const THUMB_DIR = path.join(os.tmpdir(), 'shimpli_thumbs_v2');
fs.mkdirSync(THUMB_DIR, { recursive: true });

// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════
let localVideos   = [];
let publicBaseUrl = `http://localhost:${PORT}`;
let chunkCounter  = 0;   // global chunk sequence number

// Active client sessions: ip -> { device, connectTime, bytesServed, chunks }
const activeClients = new Map();

// ═══════════════════════════════════════════════════════════════════
// PRETTY LOGGER  (no \r spam — clean structured lines)
// ═══════════════════════════════════════════════════════════════════
const C = {
  reset  : '\x1b[0m',
  bold   : '\x1b[1m',
  dim    : '\x1b[2m',
  red    : '\x1b[31m',
  green  : '\x1b[32m',
  yellow : '\x1b[33m',
  blue   : '\x1b[34m',
  magenta: '\x1b[35m',
  cyan   : '\x1b[36m',
  white  : '\x1b[37m',
  bgRed  : '\x1b[41m',
};

function ts() {
  return new Date().toTimeString().slice(0, 8);
}

function log(icon, color, label, msg) {
  console.log(`${C.dim}[${ts()}]${C.reset} ${icon} ${color}${C.bold}${label.padEnd(12)}${C.reset} ${msg}`);
}

function logStream(icon, msg) {
  console.log(`${C.dim}[${ts()}]${C.reset} ${icon} ${msg}`);
}

function logBox(lines) {
  const width = Math.max(...lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '').length)) + 4;
  const border = '═'.repeat(width);
  console.log(`\n╔${border}╗`);
  for (const line of lines) {
    const clean = line.replace(/\x1b\[[0-9;]*m/g, '');
    const pad   = width - clean.length - 2;
    console.log(`║ ${line}${' '.repeat(Math.max(0, pad))} ║`);
  }
  console.log(`╚${border}╝\n`);
}

// ═══════════════════════════════════════════════════════════════════
// DEVICE DETECTION  (from User-Agent string)
// ═══════════════════════════════════════════════════════════════════
function detectDevice(ua = '') {
  if (!ua) return { type: 'Unknown', os: 'Unknown', browser: 'Unknown' };
  const lower = ua.toLowerCase();

  let type = 'Desktop';
  if (/mobile|android|iphone|ipod/.test(lower)) type = 'Mobile';
  else if (/ipad|tablet/.test(lower))            type = 'Tablet';

  let osName = 'Unknown';
  if (/windows/.test(lower))     osName = 'Windows';
  else if (/android/.test(lower)) osName = 'Android';
  else if (/iphone|ipad/.test(lower)) osName = 'iOS';
  else if (/mac os/.test(lower))  osName = 'macOS';
  else if (/linux/.test(lower))   osName = 'Linux';

  let browser = 'Unknown';
  if (/edg\//.test(lower))       browser = 'Edge';
  else if (/chrome/.test(lower))  browser = 'Chrome';
  else if (/firefox/.test(lower)) browser = 'Firefox';
  else if (/safari/.test(lower))  browser = 'Safari';

  return { type, os: osName, browser };
}

// Format bytes nicely
function fmtBytes(b) {
  if (b < 1024)         return `${b}B`;
  if (b < 1024 * 1024)  return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / (1024 * 1024)).toFixed(2)}MB`;
}

// Format speed nicely
function fmtSpeed(bytesPerSec) {
  if (bytesPerSec < 1024)             return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024)      return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
}

// ═══════════════════════════════════════════════════════════════════
// THUMBNAIL (non-blocking: spawn ffmpeg async)
// ═══════════════════════════════════════════════════════════════════
function getThumbnailPath(filePath) {
  const hash      = crypto.createHash('md5').update(filePath).digest('hex').slice(0, 16);
  return path.join(THUMB_DIR, `thumb_${hash}.jpg`);
}

function generateThumbnailAsync(filePath) {
  const thumbPath = getThumbnailPath(filePath);
  if (fs.existsSync(thumbPath)) return;      // already cached

  // Spawn ffmpeg non-blocking so it doesn't slow down the scan
  const proc = spawn('ffmpeg', [
    '-y', '-ss', '00:00:03', '-i', filePath,
    '-vframes', '1', '-vf', 'scale=640:-2',
    '-q:v', '5', thumbPath,
  ], { stdio: 'ignore' });

  proc.on('error', () => {}); // ffmpeg not found — ignore silently
}

// ═══════════════════════════════════════════════════════════════════
// FOLDER SCANNER  (non-blocking thumbnails — scan is instant)
// ═══════════════════════════════════════════════════════════════════
function scanVideos(dir) {
  const results = [];
  try {
    for (const file of fs.readdirSync(dir)) {
      const filePath = path.join(dir, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          results.push(...scanVideos(filePath));
        } else if (SUPPORTED_EXTS.has(path.extname(file).toLowerCase())) {
          generateThumbnailAsync(filePath);   // fire-and-forget
          results.push({
            filePath,
            fileName: file,
            title   : path.basename(file, path.extname(file)).replace(/[._\-]+/g, ' ').trim(),
            size    : stat.size,
          });
        }
      } catch {}
    }
  } catch {}
  return results;
}

// ═══════════════════════════════════════════════════════════════════
// SUPABASE HEARTBEAT
// ═══════════════════════════════════════════════════════════════════
async function sendHeartbeat() {
  if (!supabase) return;
  const now = new Date().toISOString();
  const videoList = localVideos.map(v => ({
    name        : v.fileName,
    size        : v.size,
    objectUrl   : `${publicBaseUrl}/stream?file=${encodeURIComponent(v.filePath)}`,
    thumbnailUrl: `${publicBaseUrl}/thumbnail?file=${encodeURIComponent(v.filePath)}`,
  }));

  try {
    await supabase.from('videos').upsert({
      id                 : '00000000-0000-0000-0000-000000000000',
      title              : '__LAPTOP_SERVER_STATUS__',
      status             : 'online',
      master_manifest_url: publicBaseUrl,
      description        : JSON.stringify({
        videoCount     : localVideos.length,
        targetFolder,
        videos         : videoList,
        serverTimestamp: now,
      }),
      created_at: now,
    });
    log('💓', C.green, 'HEARTBEAT', `${localVideos.length} video(s) → DB updated`);
  } catch (err) {
    log('⚠️ ', C.yellow, 'HEARTBEAT', `Failed: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// CLOUDFLARED AUTO-SETUP
// ═══════════════════════════════════════════════════════════════════
const CF_BIN = path.join(__dirname, '.cloudflared',
  process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');

async function ensureCloudflared() {
  if (fs.existsSync(CF_BIN) && fs.statSync(CF_BIN).size > 10_000_000) return CF_BIN;

  fs.mkdirSync(path.dirname(CF_BIN), { recursive: true });
  const arch  = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const dlUrl = process.platform === 'win32'
    ? `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-${arch}.exe`
    : process.platform === 'darwin'
      ? `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${arch}.tgz`
      : `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}`;

  log('⬇️ ', C.cyan, 'SETUP', `Downloading cloudflared (~50MB)…`);

  if (process.platform === 'win32') {
    execSync(
      `powershell -NoProfile -Command "Invoke-WebRequest -Uri '${dlUrl}' -OutFile '${CF_BIN}' -UseBasicParsing"`,
      { stdio: 'inherit', timeout: 180_000 }
    );
  } else {
    execSync(`curl -L --output "${CF_BIN}" "${dlUrl}"`, { stdio: 'inherit', timeout: 180_000 });
    fs.chmodSync(CF_BIN, 0o755);
  }

  if (!fs.existsSync(CF_BIN) || fs.statSync(CF_BIN).size < 10_000_000) {
    throw new Error('Download incomplete');
  }
  log('✅', C.green, 'SETUP', `cloudflared ready (${(fs.statSync(CF_BIN).size / 1e6).toFixed(0)} MB)`);
  return CF_BIN;
}

// ═══════════════════════════════════════════════════════════════════
// TUNNEL MANAGER
// ═══════════════════════════════════════════════════════════════════
let tunnelProc = null;
let tunnelRetries = 0;
const MAX_RETRIES = 8;

async function startTunnel() {
  let bin;
  try {
    bin = await ensureCloudflared();
  } catch (e) {
    log('⚠️ ', C.yellow, 'TUNNEL', `Cloudflared unavailable (${e.message}), falling back…`);
    return startLocaltunnel();
  }

  return new Promise(resolve => {
    log('🌐', C.cyan, 'TUNNEL', 'Starting Cloudflare Quick Tunnel…');
    if (tunnelProc) { try { tunnelProc.kill(); } catch {} }

    tunnelProc = spawn(bin, ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolved = false;

    function parse(data) {
      const text = data.toString();
      const m = text.match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/i);
      if (m && !resolved) {
        resolved      = true;
        publicBaseUrl = m[0];
        tunnelRetries = 0;
        logBox([
          `${C.bold}${C.green}🌍  GLOBAL STREAM URL — Share with anyone!${C.reset}`,
          `${C.cyan}${publicBaseUrl}${C.reset}`,
          `${C.dim}No interstitial • Cloudflare CDN • Works on any device${C.reset}`,
        ]);
        sendHeartbeat();
        resolve(publicBaseUrl);
      }
    }

    tunnelProc.stdout.on('data', parse);
    tunnelProc.stderr.on('data', parse);

    tunnelProc.on('close', code => {
      log('⚠️ ', C.yellow, 'TUNNEL', `Closed (code ${code})`);
      if (tunnelRetries < MAX_RETRIES) {
        const delay = Math.min(2000 * Math.pow(2, tunnelRetries++), 30000);
        log('🔄', C.cyan, 'TUNNEL', `Reconnecting in ${Math.round(delay / 1000)}s… (${tunnelRetries}/${MAX_RETRIES})`);
        setTimeout(startTunnel, delay);
      } else {
        log('🔁', C.yellow, 'TUNNEL', 'Max retries, falling back to localtunnel…');
        startLocaltunnel();
      }
      if (!resolved) resolve(null);
    });

    tunnelProc.on('error', err => {
      log('⚠️ ', C.red, 'TUNNEL', `Error: ${err.message}`);
      if (!resolved) { resolved = true; startLocaltunnel().then(resolve); }
    });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        log('⏱ ', C.yellow, 'TUNNEL', 'Timeout — falling back to localtunnel…');
        startLocaltunnel().then(resolve);
      }
    }, 35_000);
  });
}

async function startLocaltunnel() {
  try {
    const lt     = require('localtunnel');
    log('🔁', C.cyan, 'TUNNEL', 'Starting localtunnel fallback…');
    const tunnel = await lt({ port: PORT });
    publicBaseUrl = tunnel.url;
    logBox([
      `${C.yellow}🔁  LOCALTUNNEL URL${C.reset}`,
      `${C.cyan}${publicBaseUrl}${C.reset}`,
      `${C.dim}Note: first browser visit may show a "Continue" page${C.reset}`,
    ]);
    tunnel.on('close', () => {
      log('🔄', C.yellow, 'TUNNEL', 'Localtunnel closed, restarting…');
      setTimeout(startLocaltunnel, 5000);
    });
    sendHeartbeat();
    return publicBaseUrl;
  } catch (e) {
    log('⚠️ ', C.red, 'TUNNEL', `Localtunnel failed: ${e.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// HTTP SERVER
// ═══════════════════════════════════════════════════════════════════
const server = http.createServer((req, res) => {
  // Universal CORS — required for <video> Range requests from browsers
  res.setHeader('Access-Control-Allow-Origin',   '*');
  res.setHeader('Access-Control-Allow-Methods',  'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',  'Range, Content-Type, bypass-tunnel-reminder');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length, Content-Type');
  res.setHeader('bypass-tunnel-reminder', 'true');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const reqUrl  = new URL(req.url, `http://localhost:${PORT}`);
  const route   = reqUrl.pathname;

  // ── /status ─────────────────────────────────────────────────────
  if (route === '/status') {
    const clients = [];
    for (const [ip, info] of activeClients.entries()) {
      clients.push({
        ip,
        device : info.device,
        since  : info.connectTime,
        bytes  : info.bytesServed,
        chunks : info.chunks,
      });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      connected    : true,
      port         : PORT,
      targetFolder,
      videoCount   : localVideos.length,
      publicBaseUrl,
      uptimeSeconds: Math.round(process.uptime()),
      activeClients: clients,
    }));
    return;
  }

  // ── /list ────────────────────────────────────────────────────────
  if (route === '/list') {
    localVideos = scanVideos(targetFolder);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(localVideos.map(v => ({
      name        : v.fileName,
      size        : v.size,
      objectUrl   : `${publicBaseUrl}/stream?file=${encodeURIComponent(v.filePath)}`,
      thumbnailUrl: `${publicBaseUrl}/thumbnail?file=${encodeURIComponent(v.filePath)}`,
    }))));
    return;
  }

  // ── /thumbnail ───────────────────────────────────────────────────
  if (route === '/thumbnail') {
    const fileParam = reqUrl.searchParams.get('file');
    if (fileParam && fs.existsSync(fileParam)) {
      const thumbPath = getThumbnailPath(fileParam);
      if (fs.existsSync(thumbPath)) {
        res.writeHead(200, {
          'Content-Type' : 'image/jpeg',
          'Cache-Control': 'public, max-age=86400, immutable',
        });
        fs.createReadStream(thumbPath).pipe(res);
        return;
      }
      // Thumbnail not generated yet — trigger and return 404 (client retries)
      generateThumbnailAsync(fileParam);
    }
    res.writeHead(404);
    res.end('Not ready yet');
    return;
  }

  // ── /stream ──────────────────────────────────────────────────────
  // TRUE HTTP RANGE STREAMING — supports 2–3 GB files, seek, mobile
  if (route === '/stream') {
    const fileParam = reqUrl.searchParams.get('file');

    if (!fileParam) {
      res.writeHead(400); res.end('Missing file parameter'); return;
    }
    if (!fs.existsSync(fileParam)) {
      res.writeHead(404); res.end(`File not found: ${fileParam}`); return;
    }

    const stat       = fs.statSync(fileParam);
    const fileSize   = stat.size;
    const fileName   = path.basename(fileParam);
    const ext        = path.extname(fileParam).toLowerCase();
    const mimeType   = MIME_MAP[ext] || 'video/mp4';
    const rangeHdr   = req.headers.range;

    // Client tracking
    const clientIp  = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')
                        .split(',')[0].trim().replace('::ffff:', '');
    const ua        = req.headers['user-agent'] || '';
    const device    = detectDevice(ua);

    if (!activeClients.has(clientIp)) {
      activeClients.set(clientIp, {
        device    : `${device.type} / ${device.os} / ${device.browser}`,
        connectTime: new Date().toLocaleTimeString(),
        bytesServed: 0,
        chunks     : 0,
      });
      log('🔌', C.magenta, 'NEW CLIENT',
        `${C.bold}${clientIp}${C.reset}  ${C.dim}${device.type} | ${device.os} | ${device.browser}${C.reset}`
      );
      log('', C.dim, '', `   UA: ${ua.slice(0, 80)}`);
    }

    const clientInfo = activeClients.get(clientIp);
    const chunkSeq   = ++chunkCounter;
    const reqStart   = Date.now();

    // Parse Range header
    let start = 0;
    let end   = fileSize - 1;

    if (rangeHdr) {
      const match = rangeHdr.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        start = parseInt(match[1], 10);
        end   = match[2] ? parseInt(match[2], 10) : fileSize - 1;
      }
    }

    // Clamp end to file size
    end = Math.min(end, fileSize - 1);

    // Safety: if start > file size, respond 416
    if (start > fileSize - 1) {
      res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
      res.end();
      return;
    }

    const chunkBytes = end - start + 1;

    // Track bytes served
    clientInfo.bytesServed += chunkBytes;
    clientInfo.chunks      += 1;

    // Progress percentage
    const pct = ((end + 1) / fileSize * 100).toFixed(1);

    // Streaming telemetry — logs when chunk finishes sending
    let bytesSent = 0;
    res.on('drain', () => {});   // allow backpressure

    res.on('finish', () => {
      const elapsedMs  = Math.max(1, Date.now() - reqStart);
      const speedBps   = chunkBytes / (elapsedMs / 1000);

      logStream('📡',
        `${C.bold}#${chunkSeq}${C.reset} ` +
        `${C.cyan}"${fileName.slice(0, 35)}"${C.reset} ` +
        `${C.green}${fmtBytes(chunkBytes)}${C.reset} ` +
        `[${C.dim}${start}–${end}${C.reset}] ` +
        `${pct}% • ` +
        `${C.yellow}${elapsedMs}ms${C.reset} • ` +
        `${C.bold}${C.green}${fmtSpeed(speedBps)}${C.reset} • ` +
        `${C.magenta}${clientIp}${C.reset} (${device.type}/${device.os})`
      );
    });

    res.on('close', () => {
      // Client disconnected mid-stream (normal for seeks)
    });

    // Send 206 Partial Content — ALWAYS, even for full file
    // This is required for the <video> element to support seeking
    res.writeHead(206, {
      'Content-Range' : `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges' : 'bytes',
      'Content-Length': chunkBytes,
      'Content-Type'  : mimeType,
      'Cache-Control' : 'no-cache',       // no caching for live streams
    });

    if (req.method === 'HEAD') { res.end(); return; }

    // Stream the file slice directly — zero extra memory buffering
    const readStream = fs.createReadStream(fileParam, { start, end });

    readStream.on('error', err => {
      log('⚠️ ', C.red, 'STREAM', `Read error: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('Read error');
      }
    });

    readStream.pipe(res);
    return;
  }

  // ── / dashboard ──────────────────────────────────────────────────
  const clients = [];
  for (const [ip, info] of activeClients.entries()) {
    clients.push(`<tr>
      <td>${ip}</td>
      <td>${info.device}</td>
      <td>${info.connectTime}</td>
      <td>${fmtBytes(info.bytesServed)}</td>
      <td>${info.chunks} chunks</td>
    </tr>`);
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html><head><title>Shimpli Media Server</title>
<style>
  body{font-family:monospace;background:#0a0a0a;color:#fff;padding:2rem;max-width:900px}
  h1{color:#e50914}h2{color:#aaa}
  table{width:100%;border-collapse:collapse;margin:1rem 0}
  th{background:#222;padding:.5rem;text-align:left;color:#e50914}
  td{padding:.4rem .5rem;border-bottom:1px solid #222;font-size:.85rem}
  .url{color:#e50914;word-break:break-all}
  .badge{display:inline-block;padding:.2rem .6rem;border-radius:99px;font-size:.75rem;background:#1a1a1a;border:1px solid #333}
</style></head><body>
<h1>🍿 Shimpli Laptop Media Server</h1>
<p>Folder: <code>${targetFolder}</code> &nbsp;|&nbsp; Videos: <strong>${localVideos.length}</strong> &nbsp;|&nbsp; Uptime: ${Math.round(process.uptime())}s</p>
<p>Public URL: <span class="url">${publicBaseUrl}</span></p>

<h2>📁 Videos</h2>
<table>
  <tr><th>Name</th><th>Size</th><th>Stream URL</th></tr>
  ${localVideos.map(v => `<tr>
    <td>${v.fileName}</td>
    <td>${(v.size / 1e6).toFixed(1)} MB</td>
    <td><a href="${publicBaseUrl}/stream?file=${encodeURIComponent(v.filePath)}" style="color:#e50914">▶ Stream</a></td>
  </tr>`).join('')}
</table>

<h2>🌐 Active Clients (${activeClients.size})</h2>
${activeClients.size === 0
  ? '<p style="color:#666">No clients connected yet</p>'
  : `<table><tr><th>IP</th><th>Device</th><th>Since</th><th>Data Served</th><th>Chunks</th></tr>${clients.join('')}</table>`
}
</body></html>`);
});

// ═══════════════════════════════════════════════════════════════════
// STARTUP
// ═══════════════════════════════════════════════════════════════════
server.listen(PORT, async () => {
  console.clear();
  logBox([
    `${C.bold}${C.green}🍿  SHIMPLI LAPTOP MEDIA SERVER  v2.0${C.reset}`,
    `Folder : ${C.cyan}${targetFolder}${C.reset}`,
    `Port   : ${C.yellow}${PORT}${C.reset}`,
  ]);

  log('🔍', C.cyan, 'SCAN', `Scanning "${targetFolder}"…`);
  localVideos = scanVideos(targetFolder);
  log('✅', C.green, 'SCAN', `Found ${localVideos.length} video(s):`);
  localVideos.forEach((v, i) => {
    log('  ', C.dim, `  ${i + 1}.`, `${v.fileName}  (${(v.size / 1e6).toFixed(1)} MB)`);
  });

  console.log('');
  log('🚀', C.green, 'SERVER', `Local: http://localhost:${PORT}`);

  // Start tunnel
  await startTunnel();

  // Initial heartbeat + interval
  await sendHeartbeat();
  setInterval(sendHeartbeat, HEARTBEAT_MS);

  // File watcher
  try {
    let watchDebounce = null;
    fs.watch(targetFolder, { recursive: true }, () => {
      clearTimeout(watchDebounce);
      watchDebounce = setTimeout(() => {
        const prev = localVideos.length;
        localVideos = scanVideos(targetFolder);
        if (localVideos.length !== prev) {
          log('📂', C.green, 'WATCHER', `Library updated: ${localVideos.length} video(s)`);
          sendHeartbeat();
        }
      }, 1000);
    });
    log('👀', C.dim, 'WATCHER', `Watching "${targetFolder}" for changes…`);
  } catch {}

  console.log('');
  log('📊', C.cyan, 'READY', `Dashboard: http://localhost:${PORT}`);
  log('📊', C.cyan, 'READY', `Streaming: ${publicBaseUrl}/stream?file=<path>`);
  console.log('');
});

// ═══════════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ═══════════════════════════════════════════════════════════════════
async function shutdown(sig) {
  console.log('');
  log('🛑', C.red, 'SHUTDOWN', `${sig} received`);
  if (tunnelProc) { try { tunnelProc.kill(); } catch {} }
  if (supabase) {
    try {
      await supabase.from('videos').upsert({
        id         : '00000000-0000-0000-0000-000000000000',
        title      : '__LAPTOP_SERVER_STATUS__',
        status     : 'offline',
        description: JSON.stringify({ videoCount: 0, videos: [], serverTimestamp: new Date().toISOString() }),
        created_at : new Date().toISOString(),
      });
      log('✅', C.green, 'SHUTDOWN', 'Marked OFFLINE in database');
    } catch {}
  }
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
