/**
 * 🍿 Shimpli Laptop Local Server with Global Public HTTPS Tunneling
 * & Real-Time Heartbeat Sync for Mobile & Remote Devices
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const localtunnel = require('localtunnel');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const PORT = 4000;
let targetFolder = process.argv[2];

// Default to C:\ShimpliVideos or ~/Movies if not specified
if (!targetFolder) {
  targetFolder = process.platform === 'win32'
    ? path.join('C:', 'ShimpliVideos')
    : path.join(os.homedir(), 'Movies', 'ShimpliVideos');
}

if (!fs.existsSync(targetFolder)) {
  try {
    fs.mkdirSync(targetFolder, { recursive: true });
    console.log(`📁 Created dedicated local media folder: "${targetFolder}"`);
  } catch (err) {
    targetFolder = process.cwd();
  }
}

// Supabase setup for live mobile heartbeat sync
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// Temporary directory for generated video thumbnails
const THUMB_DIR = path.join(os.tmpdir(), 'shimpli_thumbs');
fs.mkdirSync(THUMB_DIR, { recursive: true });

console.log(`\n🍿 [Shimpli Laptop Server] Hosting videos from: "${targetFolder}"`);

const SUPPORTED_EXTS = ['.mp4', '.mkv', '.webm', '.mov', '.avi'];
let publicBaseUrl = `http://localhost:${PORT}`;

// Send heartbeat to Supabase DB so mobile devices receive laptop videos
async function sendHeartbeat() {
  if (!supabase) return;
  const statusId = '00000000-0000-0000-0000-000000000000';
  const enrichedList = localVideos.map(v => ({
    name: v.fileName || v.title,
    size: v.size,
    objectUrl: `${publicBaseUrl}/stream?file=${encodeURIComponent(v.filePath)}`,
    thumbnailUrl: `${publicBaseUrl}/thumbnail?file=${encodeURIComponent(v.filePath)}`,
  }));

  try {
    await supabase.from('videos').upsert({
      id: statusId,
      title: '__LAPTOP_SERVER_STATUS__',
      status: 'online',
      master_manifest_url: publicBaseUrl,
      description: JSON.stringify({
        videoCount: localVideos.length,
        targetFolder,
        videos: enrichedList,
      }),
      created_at: new Date().toISOString(),
    });
  } catch (err) {}
}

// Helper: Extract cover thumbnail using FFmpeg
function getOrGenerateThumbnail(filePath) {
  try {
    const hash = Buffer.from(filePath).toString('hex').slice(-20);
    const thumbPath = path.join(THUMB_DIR, `thumb_${hash}.jpg`);

    if (fs.existsSync(thumbPath)) {
      return thumbPath;
    }

    const cmd = `ffmpeg -y -ss 00:00:02 -i "${filePath}" -vframes 1 -vf scale=640:-1 -q:v 4 "${thumbPath}"`;
    execSync(cmd, { stdio: 'ignore', timeout: 5000 });

    if (fs.existsSync(thumbPath)) {
      return thumbPath;
    }
  } catch (err) {}
  return null;
}

function scanVideos(dir) {
  let results = [];
  try {
    const list = fs.readdirSync(dir);
    list.forEach((file) => {
      const filePath = path.join(dir, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
          results = results.concat(scanVideos(filePath));
        } else {
          const ext = path.extname(file).toLowerCase();
          if (SUPPORTED_EXTS.includes(ext)) {
            const thumbPath = getOrGenerateThumbnail(filePath);
            results.push({
              filePath,
              fileName: file,
              title: path.basename(file, ext).replace(/[._-]/g, ' '),
              size: stat.size,
              hasThumbnail: !!thumbPath,
            });
          }
        }
      } catch (e) {}
    });
  } catch (e) {}
  return results;
}

let localVideos = scanVideos(targetFolder);
console.log(`✅ Indexed ${localVideos.length} video(s) on your laptop!\n`);

// High-Speed HTTP Server with Cover Thumbnail Serving & Stream Chunking
const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, bypass-tunnel-reminder');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);

  // Server Status Endpoint
  if (reqUrl.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'online',
      connected: true,
      port: PORT,
      targetFolder,
      videoCount: localVideos.length,
      publicBaseUrl,
      uptimeSeconds: Math.round(process.uptime()),
    }));
    return;
  }

  // Cover Picture / Thumbnail Endpoint
  if (reqUrl.pathname === '/thumbnail') {
    const fileParam = reqUrl.searchParams.get('file');
    if (fileParam && fs.existsSync(fileParam)) {
      const thumbPath = getOrGenerateThumbnail(fileParam);
      if (thumbPath && fs.existsSync(thumbPath)) {
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=86400',
        });
        fs.createReadStream(thumbPath).pipe(res);
        return;
      }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Thumbnail not found');
    return;
  }

  if (reqUrl.pathname === '/list') {
    localVideos = scanVideos(targetFolder);
    const enrichedList = localVideos.map(v => ({
      name: v.fileName || v.title,
      size: v.size,
      objectUrl: `${publicBaseUrl}/stream?file=${encodeURIComponent(v.filePath)}`,
      thumbnailUrl: `${publicBaseUrl}/thumbnail?file=${encodeURIComponent(v.filePath)}`,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(enrichedList));
    return;
  }

  if (reqUrl.pathname === '/stream') {
    const fileParam = reqUrl.searchParams.get('file');
    if (!fileParam || !fs.existsSync(fileParam)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File not found');
      return;
    }

    const startTime = Date.now();
    const fileName  = path.basename(fileParam);
    const stat      = fs.statSync(fileParam);
    const fileSize  = stat.size;
    const range     = req.headers.range;

    const mimeType  = fileParam.endsWith('.mkv') ? 'video/x-matroska' : 'video/mp4';
    const MAX_CHUNK = 1.5 * 1024 * 1024; // 1.5 MB max per Range response for instant buffering

    let start = 0;
    let end = Math.min(MAX_CHUNK - 1, fileSize - 1);

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      start = parseInt(parts[0], 10);
      const requestedEnd = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      end = Math.min(requestedEnd, start + MAX_CHUNK - 1, fileSize - 1);
    }

    const chunksize = (end - start) + 1;

    // Log streaming telemetry on completion of chunk transfer
    res.on('finish', () => {
      const elapsedMs = Math.max(1, Date.now() - startTime);
      const mbSent    = (chunksize / (1024 * 1024)).toFixed(2);
      const speedMBps = ((chunksize / (1024 * 1024)) / (elapsedMs / 1000)).toFixed(1);
      const clientIp  = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

      console.log(`📡 [STREAMING ⚡] "${fileName}" | Chunk: ${mbSent} MB (bytes ${start}-${end}/${fileSize}) | Latency: ${elapsedMs}ms | Speed: ⚡ ${speedMBps} MB/s | Client: ${clientIp}`);
    });

    if (range) {
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=3600',
      });
      fs.createReadStream(fileParam, { start, end }).pipe(res);
    } else {
      res.writeHead(206, {
        'Content-Range': `bytes 0-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=3600',
      });
      fs.createReadStream(fileParam, { start: 0, end }).pipe(res);
    }
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`
    <h1>🍿 Shimpli Laptop Media Server Running!</h1>
    <p>Hosting <strong>${localVideos.length}</strong> videos from <code>${targetFolder}</code></p>
  `);
});

server.listen(PORT, async () => {
  console.log(`\n🚀 [Shimpli Laptop Server Active on Port ${PORT}]`);

  // Launch Global Secure HTTPS Public Tunnel
  try {
    console.log(`🌐 Generating Global Public HTTPS Tunnel for remote users...`);
    const tunnel = await localtunnel({ port: PORT });
    publicBaseUrl = tunnel.url;
    console.log(`🌍 PUBLIC GLOBAL STREAM URL: ${publicBaseUrl}`);

    tunnel.on('close', () => {
      console.warn('⚠️ Public tunnel closed.');
    });
  } catch (tErr) {
    console.warn('⚠️ Could not open public tunnel. Falling back to local IP:', tErr.message);
  }

  // Initial heartbeat + 10-second recurring heartbeat
  await sendHeartbeat();
  setInterval(sendHeartbeat, 10000);

  // Real-Time Folder Watcher
  try {
    fs.watch(targetFolder, { recursive: true }, () => {
      localVideos = scanVideos(targetFolder);
      sendHeartbeat();
    });
    console.log(`👀 Watching "${targetFolder}" for new video files in real-time...`);
  } catch (wErr) {}
});
