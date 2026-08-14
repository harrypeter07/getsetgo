/**
 * 🍿 Shimpli Local Laptop Video Server Agent (Zero-Upload High-Speed Streaming Engine)
 *
 * Automatically watches a folder on your laptop (e.g. C:\ShimpliVideos or D:\Movies)
 * and streams videos directly to your website with ZERO upload wait time!
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
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

console.log(`\n🍿 [Shimpli Local Server] Hosting videos from: "${targetFolder}"`);

// Supabase setup
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

const SUPPORTED_EXTS = ['.mp4', '.mkv', '.webm', '.mov', '.avi'];

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

// Maintain tracked set of registered titles to eliminate duplicate logs
const syncedTitles = new Set();

async function syncToSupabase() {
  if (!supabase) {
    return;
  }

  localVideos = scanVideos(targetFolder);

  for (const item of localVideos) {
    if (syncedTitles.has(item.title)) {
      continue;
    }

    const localStreamUrl = `http://localhost:${PORT}/stream?file=${encodeURIComponent(item.filePath)}`;
    try {
      const { data: existing } = await supabase.from('videos').select('id').eq('title', item.title).limit(1);
      if (!existing || existing.length === 0) {
        await supabase.from('videos').insert({
          title: item.title,
          status: 'ready',
          master_manifest_url: localStreamUrl,
          available_qualities: ['1080p (Laptop Direct ⚡)'],
        });
        syncedTitles.add(item.title);
        console.log(`✨ Registered on Website: "${item.title}"`);
      } else {
        syncedTitles.add(item.title);
      }
    } catch (err) {
      console.warn(`Could not sync "${item.title}" to Supabase:`, err.message);
    }
  }
}

syncToSupabase();

// Real-Time Folder Watcher with 1.5s Debounce Timer
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

// High-Speed HTTP Server with Range Requests (Partial Content) for instant video seeking
const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');

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

server.listen(PORT, () => {
  console.log(`\n🚀 [Shimpli Laptop Local Server Ready!]`);
  console.log(`🔗 Local Stream Base: http://localhost:${PORT}`);
  console.log(`📁 Videos Folder: "${targetFolder}"`);
  console.log(`💡 Drop any video file into "${targetFolder}" to instantly show it on your website!\n`);
});
