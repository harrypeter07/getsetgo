/**
 * Shimpli Local Laptop Video Server Agent
 * Run this on your laptop to instantly host and stream any folder of videos directly to your website!
 *
 * Usage:
 *   node scripts/local-server.js "C:\Users\YourName\Videos"
 *   OR:
 *   node scripts/local-server.js "D:\Movies"
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const PORT = 4000;
const targetFolder = process.argv[2] || process.cwd();

if (!fs.existsSync(targetFolder)) {
  console.error(`❌ Folder does not exist: "${targetFolder}"`);
  process.exit(1);
}

console.log(`\n🍿 [Shimpli Local Server] Indexing videos in: "${targetFolder}"`);

// Supabase setup
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

const SUPPORTED_EXTS = ['.mp4', '.mkv', '.webm', '.mov', '.avi'];

function scanVideos(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const filePath = path.join(dir, file);
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
  });
  return results;
}

const localVideos = scanVideos(targetFolder);
console.log(`✅ Found ${localVideos.length} video(s) in folder!\n`);

// Register local videos with Supabase DB so website displays them
async function syncToSupabase() {
  if (!supabase) {
    console.warn('⚠️ Supabase credentials missing in .env.local. Running in local standalone mode.');
    return;
  }

  for (const item of localVideos) {
    const localStreamUrl = `http://localhost:${PORT}/stream?file=${encodeURIComponent(item.filePath)}`;
    try {
      const { data: existing } = await supabase.from('videos').select('id').eq('title', item.title).limit(1);
      if (!existing || existing.length === 0) {
        await supabase.from('videos').insert({
          title: item.title,
          status: 'ready',
          master_manifest_url: localStreamUrl,
          available_qualities: ['1080p (Local Laptop Direct)'],
        });
        console.log(`✨ Registered on Website: "${item.title}"`);
      }
    } catch (err) {
      console.warn(`Could not sync "${item.title}" to Supabase:`, err.message);
    }
  }
}

syncToSupabase();

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
        'Content-Type': 'video/mp4',
      });
      file.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
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
  console.log(`\n🚀 [Shimpli Local Server Ready!]`);
  console.log(`🔗 Local Stream Base: http://localhost:${PORT}`);
  console.log(`📂 Videos indexed: ${localVideos.length}`);
  console.log(`💡 Keep this terminal open while watching local videos on your website!\n`);
});
