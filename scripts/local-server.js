/**
 * 🍿 Shimpli Laptop Local Server with Global Public HTTPS Tunneling
 *
 * Streams videos directly from your laptop to anyone in ANY city worldwide
 * without uploading anything to cloud storage!
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
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

console.log(`\n🍿 [Shimpli Laptop Server] Hosting videos from: "${targetFolder}"`);

// Supabase setup
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

const SUPPORTED_EXTS = ['.mp4', '.mkv', '.webm', '.mov', '.avi'];
let publicBaseUrl = `http://localhost:${PORT}`;

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
            results.push({
              filePath,
              fileName: file,
              title: path.basename(file, ext).replace(/[._-]/g, ' '),
              size: stat.size,
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

const syncedTitles = new Set();

async function syncToSupabase() {
  if (!supabase) {
    return;
  }

  localVideos = scanVideos(targetFolder);

  for (const item of localVideos) {
    const publicStreamUrl = `${publicBaseUrl}/stream?file=${encodeURIComponent(item.filePath)}`;
    try {
      const { data: existing } = await supabase.from('videos').select('id, master_manifest_url').eq('title', item.title).limit(1);

      if (!existing || existing.length === 0) {
        await supabase.from('videos').insert({
          title: item.title,
          status: 'ready',
          master_manifest_url: publicStreamUrl,
          available_qualities: ['1080p (Laptop Global Direct 🌍)'],
        });
        syncedTitles.add(item.title);
        console.log(`✨ Registered Worldwide Stream: "${item.title}"`);
      } else if (existing[0] && existing[0].master_manifest_url !== publicStreamUrl) {
        // Update URL if tunnel refreshed
        await supabase.from('videos').update({
          master_manifest_url: publicStreamUrl,
          available_qualities: ['1080p (Laptop Global Direct 🌍)'],
        }).eq('id', existing[0].id);
        syncedTitles.add(item.title);
        console.log(`🔄 Updated Stream URL for Remote Access: "${item.title}"`);
      }
    } catch (err) {
      console.warn(`Could not sync "${item.title}" to Supabase:`, err.message);
    }
  }
}

// High-Speed HTTP Server with Range Requests (Partial Content) for instant video seeking
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

  if (reqUrl.pathname === '/list') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(localVideos));
    return;
  }

  if (reqUrl.pathname === '/stream') {
    const fileParam = reqUrl.searchParams.get('file');
    if (!fileParam || !fs.existsSync(fileParam)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File not found');
      return;
    }

    const stat = fs.statSync(fileParam);
    const fileSize = stat.size;
    const range = req.headers.range;

    const mimeType = fileParam.endsWith('.mkv') ? 'video/x-matroska' : 'video/mp4';

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(fileParam, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': mimeType,
      });
      file.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
      });
      fs.createReadStream(fileParam).pipe(res);
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
    console.log(`🌐 Generating Global Public HTTPS Tunnel for remote users in other cities...`);
    const tunnel = await localtunnel({ port: PORT });
    publicBaseUrl = tunnel.url;
    console.log(`🌍 PUBLIC GLOBAL STREAM URL: ${publicBaseUrl}`);

    tunnel.on('close', () => {
      console.warn('⚠️ Public tunnel closed.');
    });
  } catch (tErr) {
    console.warn('⚠️ Could not open public tunnel. Falling back to local IP:', tErr.message);
  }

  // Sync to database with public stream URL
  await syncToSupabase();

  // Real-Time Folder Watcher
  let watchTimer = null;
  try {
    fs.watch(targetFolder, { recursive: true }, (eventType, filename) => {
      if (filename && SUPPORTED_EXTS.some(ext => filename.toLowerCase().endsWith(ext))) {
        if (watchTimer) clearTimeout(watchTimer);
        watchTimer = setTimeout(() => {
          console.log(`\n🔔 Syncing new/updated video files from "${targetFolder}"...`);
          syncToSupabase();
        }, 1500);
      }
    });
    console.log(`👀 Watching "${targetFolder}" for new video files in real-time...`);
  } catch (wErr) {
    console.warn('Folder watching active in manual refresh mode.');
  }
});
