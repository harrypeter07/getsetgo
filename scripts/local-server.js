/**
 * 🍿 Shimpli Laptop Local Media Server
 *
 * Features:
 *  - Cloudflare Quick Tunnel (no interstitial, CDN-backed, reliable)
 *  - Auto-download cloudflared binary on first run (Windows/Mac/Linux)
 *  - Auto-reconnect with exponential backoff if tunnel drops
 *  - Adaptive HTTP Range chunking (512KB–2MB) for smooth mobile streaming
 *  - FFmpeg thumbnail extraction for video cover pictures
 *  - Supabase heartbeat every 10s for instant mobile status
 *  - Real-time folder watcher (no restart needed when files added)
 *  - Detailed streaming telemetry logs
 */

const http      = require('http');
const fs        = require('fs');
const path      = require('path');
const os        = require('os');
const { execSync, spawn } = require('child_process');
const { createClient }    = require('@supabase/supabase-js');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });


// ─── CONFIG ──────────────────────────────────────────────────────────────────
const PORT           = 4000;
const MAX_CHUNK_BYTES = 2 * 1024 * 1024;   // 2 MB max per chunk
const MIN_CHUNK_BYTES = 512 * 1024;         // 512 KB initial chunk
const HEARTBEAT_MS   = 10_000;             // 10 second supabase heartbeat
const SUPPORTED_EXTS = ['.mp4', '.mkv', '.webm', '.mov', '.avi', '.m4v'];

// ─── FOLDER ───────────────────────────────────────────────────────────────────
let targetFolder = process.argv[2];
if (!targetFolder) {
  targetFolder = process.platform === 'win32'
    ? path.join('C:', 'ShimpliVideos')
    : path.join(os.homedir(), 'ShimpliVideos');
}
if (!fs.existsSync(targetFolder)) {
  try { fs.mkdirSync(targetFolder, { recursive: true }); } catch {}
}

// ─── SUPABASE ─────────────────────────────────────────────────────────────────
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase    = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// ─── THUMBNAIL CACHE DIR ──────────────────────────────────────────────────────
const THUMB_DIR = path.join(os.tmpdir(), 'shimpli_thumbs');
fs.mkdirSync(THUMB_DIR, { recursive: true });

// ─── STATE ────────────────────────────────────────────────────────────────────
let localVideos  = [];
let publicBaseUrl = `http://localhost:${PORT}`;

console.log('\n🍿 ═══════════════════════════════════════════════════');
console.log(`   Shimpli Laptop Media Server`);
console.log(`   Hosting: "${targetFolder}"`);
console.log('═══════════════════════════════════════════════════\n');

// ─── THUMBNAIL EXTRACTION ────────────────────────────────────────────────────
function getOrGenerateThumbnail(filePath) {
  try {
    const hash      = require('crypto').createHash('md5').update(filePath).digest('hex').slice(0, 16);
    const thumbPath = path.join(THUMB_DIR, `thumb_${hash}.jpg`);
    if (fs.existsSync(thumbPath)) return thumbPath;

    // Use ffmpeg to extract frame at 2 seconds, 640px wide
    execSync(
      `ffmpeg -y -ss 00:00:02 -i "${filePath}" -vframes 1 -vf "scale=640:-2" -q:v 5 "${thumbPath}"`,
      { stdio: 'ignore', timeout: 8000 }
    );
    return fs.existsSync(thumbPath) ? thumbPath : null;
  } catch {
    return null;
  }
}

// ─── FOLDER SCANNER ──────────────────────────────────────────────────────────
function scanVideos(dir) {
  const results = [];
  try {
    for (const file of fs.readdirSync(dir)) {
      const filePath = path.join(dir, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          results.push(...scanVideos(filePath));
        } else if (SUPPORTED_EXTS.includes(path.extname(file).toLowerCase())) {
          const thumbPath = getOrGenerateThumbnail(filePath);
          results.push({
            filePath,
            fileName : file,
            title    : path.basename(file, path.extname(file)).replace(/[._-]+/g, ' ').trim(),
            size     : stat.size,
            thumbPath,
          });
        }
      } catch {}
    }
  } catch {}
  return results;
}

// ─── SUPABASE HEARTBEAT ───────────────────────────────────────────────────────
async function sendHeartbeat() {
  if (!supabase) return;
  const now = new Date().toISOString();
  const videoList = localVideos.map(v => ({
    name        : v.fileName,
    size        : v.size,
    objectUrl   : `${publicBaseUrl}/stream?file=${encodeURIComponent(v.filePath)}`,
    thumbnailUrl: `${publicBaseUrl}/thumbnail?file=${encodeURIComponent(v.filePath)}`,
  }));

  const payload = JSON.stringify({
    videoCount     : localVideos.length,
    targetFolder,
    videos         : videoList,
    serverTimestamp: now,   // <-- store timestamp in payload (not relying on DB created_at)
  });

  try {
    await supabase.from('videos').upsert({
      id                 : '00000000-0000-0000-0000-000000000000',
      title              : '__LAPTOP_SERVER_STATUS__',
      status             : 'online',
      master_manifest_url: publicBaseUrl,
      description        : payload,
      created_at         : now,
    });
    process.stdout.write(`💓 Heartbeat sent — ${localVideos.length} videos @ ${publicBaseUrl}\r`);
  } catch (err) {
    console.warn('⚠️  Heartbeat failed:', err.message);
  }
}

// ─── CLOUDFLARED AUTO-DOWNLOAD ────────────────────────────────────────────────
function getCloudflareBinaryPath() {
  const dir  = path.join(__dirname, '.cloudflared');
  const name = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  return path.join(dir, name);
}

async function downloadCloudflared() {
  const binPath = getCloudflareBinaryPath();
  const MIN_SIZE = 10 * 1024 * 1024; // 10 MB minimum valid binary size

  // Return cached binary if it exists and is large enough
  if (fs.existsSync(binPath) && fs.statSync(binPath).size > MIN_SIZE) {
    return binPath;
  }

  fs.mkdirSync(path.dirname(binPath), { recursive: true });

  const platform = process.platform;
  const arch     = process.arch === 'x64' ? 'amd64' : process.arch === 'arm64' ? 'arm64' : 'amd64';

  let downloadUrl;
  if (platform === 'win32') {
    downloadUrl = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-${arch}.exe`;
  } else if (platform === 'darwin') {
    downloadUrl = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${arch}.tgz`;
  } else {
    downloadUrl = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}`;
  }

  console.log(`⬇️  Downloading cloudflared (~30MB) from GitHub...`);

  try {
    if (platform === 'win32') {
      // Use PowerShell Invoke-WebRequest — handles GitHub → S3 redirects natively
      execSync(
        `powershell -NoProfile -Command "Invoke-WebRequest -Uri '${downloadUrl}' -OutFile '${binPath}' -UseBasicParsing"`,
        { stdio: 'inherit', timeout: 180_000 }
      );
    } else {
      // Use curl.exe on macOS/Linux
      execSync(
        `curl -L --output "${binPath}" "${downloadUrl}"`,
        { stdio: 'inherit', timeout: 180_000 }
      );
    }
  } catch (downloadErr) {
    // Last resort: try curl.exe (real binary, not PS alias) on Windows
    if (platform === 'win32') {
      try {
        execSync(
          `curl.exe -L --output "${binPath}" "${downloadUrl}"`,
          { stdio: 'inherit', timeout: 180_000 }
        );
      } catch {
        throw downloadErr;
      }
    } else {
      throw downloadErr;
    }
  }

  if (!fs.existsSync(binPath) || fs.statSync(binPath).size < MIN_SIZE) {
    throw new Error('cloudflared binary download failed or is incomplete');
  }

  if (platform !== 'win32') {
    try { fs.chmodSync(binPath, 0o755); } catch {}
  }

  console.log(`✅ cloudflared ready: ${binPath} (${(fs.statSync(binPath).size / 1e6).toFixed(1)} MB)`);
  return binPath;
}

// ─── TUNNEL MANAGER ──────────────────────────────────────────────────────────
let tunnelProcess = null;
let tunnelRetries = 0;
const MAX_RETRIES = 10;

async function startCloudflareTunnel() {
  let binPath;
  try {
    binPath = await downloadCloudflared();
  } catch (err) {
    console.warn(`⚠️  Could not download cloudflared: ${err.message}. Falling back to localtunnel...`);
    return startLocaltunnel();
  }

  return new Promise(resolve => {
    console.log('\n🌐 Starting Cloudflare Quick Tunnel (no interstitial page, CDN-backed)...');

    if (tunnelProcess) {
      try { tunnelProcess.kill(); } catch {}
    }

    tunnelProcess = spawn(binPath, ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolved = false;

    function parseTunnelUrl(data) {
      const text = data.toString();
      // cloudflared prints the URL in stderr like: https://xxxx.trycloudflare.com
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (match && !resolved) {
        resolved = true;
        publicBaseUrl = match[0];
        tunnelRetries = 0;
        console.log('\n');
        console.log('╔══════════════════════════════════════════════════════════════╗');
        console.log('║  🌍  GLOBAL PUBLIC STREAM URL (Share this with friends!)     ║');
        console.log(`║  ${publicBaseUrl.padEnd(60)}║`);
        console.log('╚══════════════════════════════════════════════════════════════╝');
        console.log('  ✅ No interstitial page | CDN-backed | Works on any device\n');
        sendHeartbeat();
        resolve(publicBaseUrl);
      }
    }

    tunnelProcess.stdout.on('data', parseTunnelUrl);
    tunnelProcess.stderr.on('data', parseTunnelUrl);

    tunnelProcess.on('close', code => {
      console.warn(`\n⚠️  Cloudflare tunnel closed (code ${code})`);
      if (tunnelRetries < MAX_RETRIES) {
        const delay = Math.min(1000 * Math.pow(2, tunnelRetries), 30000);
        tunnelRetries++;
        console.log(`🔄 Auto-reconnecting in ${Math.round(delay / 1000)}s (attempt ${tunnelRetries}/${MAX_RETRIES})...`);
        setTimeout(startCloudflareTunnel, delay);
      } else {
        console.warn('⚠️  Max tunnel retries reached. Falling back to localtunnel...');
        startLocaltunnel();
      }
      if (!resolved) resolve(null);
    });

    tunnelProcess.on('error', err => {
      console.warn(`⚠️  Cloudflare tunnel process error: ${err.message}`);
      if (!resolved) {
        resolved = true;
        console.warn('  Falling back to localtunnel...');
        startLocaltunnel().then(resolve);
      }
    });

    // Timeout: if tunnel URL not received in 30s, fall back
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.warn('⚠️  Cloudflare tunnel took too long. Falling back to localtunnel...');
        startLocaltunnel().then(resolve);
      }
    }, 30000);
  });
}

async function startLocaltunnel() {
  try {
    const localtunnel = require('localtunnel');
    console.log('\n🔁 Starting localtunnel as fallback...');
    const tunnel = await localtunnel({ port: PORT });
    publicBaseUrl = tunnel.url;
    console.log(`🌍 LOCALTUNNEL URL: ${publicBaseUrl}`);
    console.log(`⚠️  Note: localtunnel requires visitors to click "Continue" on first visit`);
    console.log(`   Bypass URL for direct stream access: add header "bypass-tunnel-reminder: true"`);

    tunnel.on('close', () => {
      console.warn('⚠️  Localtunnel closed. Attempting restart...');
      setTimeout(startLocaltunnel, 5000);
    });

    sendHeartbeat();
    return publicBaseUrl;
  } catch (err) {
    console.warn('⚠️  Localtunnel failed:', err.message);
    return null;
  }
}

// ─── HTTP SERVER ─────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // CORS + security headers
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, bypass-tunnel-reminder, ngrok-skip-browser-warning');
  res.setHeader('Access-Control-Expose-Headers','Content-Range, Accept-Ranges, Content-Length');
  res.setHeader('bypass-tunnel-reminder', 'true');       // auto-bypass localtunnel interstitial
  res.setHeader('ngrok-skip-browser-warning', 'true');   // auto-bypass ngrok warning

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);

  // ── /status ──────────────────────────────────────────────────────────────
  if (reqUrl.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status       : 'online',
      connected    : true,
      port         : PORT,
      targetFolder,
      videoCount   : localVideos.length,
      publicBaseUrl,
      uptimeSeconds: Math.round(process.uptime()),
    }));
    return;
  }

  // ── /list ─────────────────────────────────────────────────────────────────
  if (reqUrl.pathname === '/list') {
    localVideos = scanVideos(targetFolder);
    const list  = localVideos.map(v => ({
      name        : v.fileName,
      size        : v.size,
      objectUrl   : `${publicBaseUrl}/stream?file=${encodeURIComponent(v.filePath)}`,
      thumbnailUrl: `${publicBaseUrl}/thumbnail?file=${encodeURIComponent(v.filePath)}`,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(list));
    return;
  }

  // ── /thumbnail ───────────────────────────────────────────────────────────
  if (reqUrl.pathname === '/thumbnail') {
    const fileParam = reqUrl.searchParams.get('file');
    if (fileParam && fs.existsSync(fileParam)) {
      const thumbPath = getOrGenerateThumbnail(fileParam);
      if (thumbPath && fs.existsSync(thumbPath)) {
        res.writeHead(200, {
          'Content-Type' : 'image/jpeg',
          'Cache-Control': 'public, max-age=86400, immutable',
        });
        fs.createReadStream(thumbPath).pipe(res);
        return;
      }
    }
    res.writeHead(404);
    res.end('Thumbnail not found');
    return;
  }

  // ── /stream ──────────────────────────────────────────────────────────────
  if (reqUrl.pathname === '/stream') {
    const fileParam = reqUrl.searchParams.get('file');

    if (!fileParam || !fs.existsSync(fileParam)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File not found', file: fileParam }));
      return;
    }

    const startTime  = Date.now();
    const fileName   = path.basename(fileParam);
    const stat       = fs.statSync(fileParam);
    const fileSize   = stat.size;
    const rangeHeader = req.headers.range;
    const clientIp   = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

    // Detect MIME type
    const ext = path.extname(fileParam).toLowerCase();
    const mimeMap = {
      '.mp4' : 'video/mp4',
      '.webm': 'video/webm',
      '.mkv' : 'video/x-matroska',
      '.mov' : 'video/quicktime',
      '.avi' : 'video/x-msvideo',
      '.m4v' : 'video/mp4',
    };
    const mimeType = mimeMap[ext] || 'video/mp4';

    // Adaptive chunk sizing:
    // - First request (no range or range starts at 0): send small 512KB chunk → fast time-to-first-frame
    // - Subsequent range requests: send up to 2MB per chunk → smooth streaming
    let chunkCap = MAX_CHUNK_BYTES;

    let start = 0;
    let end   = Math.min(MIN_CHUNK_BYTES - 1, fileSize - 1); // default first chunk

    if (rangeHeader) {
      const parts    = rangeHeader.replace(/bytes=/, '').split('-');
      const reqStart = parseInt(parts[0], 10) || 0;
      const reqEnd   = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      start    = reqStart;
      // If this is a seek-ahead or large request, cap at MAX_CHUNK_BYTES
      chunkCap = (reqStart === 0) ? MIN_CHUNK_BYTES : MAX_CHUNK_BYTES;
      end      = Math.min(reqEnd, start + chunkCap - 1, fileSize - 1);
    }

    const chunkSize = (end - start) + 1;

    // Telemetry log on chunk finish
    res.on('finish', () => {
      const elapsed  = Math.max(1, Date.now() - startTime);
      const mbSent   = (chunkSize / (1024 * 1024)).toFixed(2);
      const speedMBs = ((chunkSize / (1024 * 1024)) / (elapsed / 1000)).toFixed(1);
      const pct      = ((end + 1) / fileSize * 100).toFixed(1);
      console.log(
        `📡 "${fileName}" | ${mbSent}MB chunk [${start}–${end}] (${pct}%) | ` +
        `${elapsed}ms | ⚡${speedMBs}MB/s | ${clientIp || 'local'}`
      );
    });

    res.writeHead(206, {
      'Content-Range' : `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges' : 'bytes',
      'Content-Length': chunkSize,
      'Content-Type'  : mimeType,
      'Cache-Control' : 'public, max-age=3600',
    });

    fs.createReadStream(fileParam, { start, end }).pipe(res);
    return;
  }

  // ── Root dashboard ────────────────────────────────────────────────────────
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html><head><title>Shimpli Laptop Server</title>
<style>body{font-family:monospace;background:#0a0a0a;color:#fff;padding:2rem;}</style>
</head><body>
<h1>🍿 Shimpli Laptop Media Server</h1>
<p>Hosting <strong>${localVideos.length}</strong> videos from <code>${targetFolder}</code></p>
<p>Public URL: <a href="${publicBaseUrl}" style="color:#e50914">${publicBaseUrl}</a></p>
<p>Uptime: ${Math.round(process.uptime())}s</p>
<ul>${localVideos.map(v => `<li>${v.fileName} (${(v.size / 1e6).toFixed(1)} MB)</li>`).join('')}</ul>
</body></html>`);
});

// ─── STARTUP ──────────────────────────────────────────────────────────────────
server.listen(PORT, async () => {
  // Scan videos first
  console.log('🔍 Scanning videos...');
  localVideos = scanVideos(targetFolder);
  console.log(`✅ Indexed ${localVideos.length} video(s)\n`);

  console.log(`🚀 Local server active: http://localhost:${PORT}`);

  // Start tunnel (Cloudflare first, localtunnel fallback)
  await startCloudflareTunnel();

  // Start heartbeat loop
  await sendHeartbeat();
  setInterval(sendHeartbeat, HEARTBEAT_MS);

  // Watch folder for new files
  try {
    fs.watch(targetFolder, { recursive: true }, () => {
      localVideos = scanVideos(targetFolder);
      sendHeartbeat();
    });
    console.log(`👀 Watching "${targetFolder}" for new files...`);
  } catch {}
});

// ─── GRACEFUL SHUTDOWN ────────────────────────────────────────────────────────
async function shutdown(signal) {
  console.log(`\n🛑 ${signal} received — shutting down gracefully...`);
  if (tunnelProcess) {
    try { tunnelProcess.kill(); } catch {}
  }
  // Mark server offline in Supabase
  if (supabase) {
    try {
      await supabase.from('videos').upsert({
        id    : '00000000-0000-0000-0000-000000000000',
        title : '__LAPTOP_SERVER_STATUS__',
        status: 'offline',
        description: JSON.stringify({ videoCount: 0, videos: [] }),
        created_at: new Date().toISOString(),
      });
      console.log('✅ Marked server OFFLINE in database');
    } catch {}
  }
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGQUIT', () => shutdown('SIGQUIT'));
