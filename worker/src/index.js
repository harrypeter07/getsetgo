/**
 * worker/src/index.js
 *
 * Cloudflare Worker — Authenticated proxy for private Backblaze B2 bucket.
 *
 * Route: GET /video/{videoId}/{...path}
 *   e.g. /video/abc123/master.m3u8
 *        /video/abc123/480p/seg_003.ts
 *
 * Flow:
 *   1. Parse path → build B2 S3 key
 *   2. Sign request with AWS SigV4 (B2 is S3-compatible)
 *   3. Check Cloudflare edge cache first
 *   4. Fetch from B2 if not cached
 *   5. Set correct Content-Type + Cache-Control headers
 *   6. Store in edge cache + return to client
 *
 * Secrets (set via: wrangler secret put B2_KEY_ID / B2_APPLICATION_KEY):
 *   env.B2_KEY_ID          — Backblaze applicationKeyId
 *   env.B2_APPLICATION_KEY — Backblaze applicationKey (secret)
 *
 * Vars (in wrangler.toml [vars]):
 *   env.B2_BUCKET_NAME — e.g. "getitfast"
 *   env.B2_ENDPOINT    — e.g. "s3.us-east-005.backblazeb2.com"
 */

// ─── AWS SigV4 signing (pure Workers-compatible implementation) ───────────────

async function hmacSha256(key, data) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    typeof key === 'string' ? new TextEncoder().encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
}

async function sha256Hex(data) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function toHex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Signs an S3-compatible GET request with AWS Signature Version 4.
 */
async function signS3Request({ method, host, path, region, keyId, secretKey, service = 's3' }) {
  const now = new Date();
  const dateStr = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const dateShort = dateStr.slice(0, 8);

  const payloadHash = await sha256Hex('');

  const headers = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': dateStr,
  };

  // Canonical headers (sorted by key)
  const sortedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaderKeys.map(k => `${k}:${headers[k]}`).join('\n') + '\n';
  const signedHeaders = sortedHeaderKeys.join(';');

  const canonicalRequest = [
    method,
    path,
    '', // query string (empty for GET)
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateShort}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    dateStr,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  // Derive signing key
  const kDate    = await hmacSha256(`AWS4${secretKey}`, dateShort);
  const kRegion  = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, 'aws4_request');

  const signatureBuf = await hmacSha256(kSigning, stringToSign);
  const signature = toHex(signatureBuf);

  const authorization = `AWS4-HMAC-SHA256 Credential=${keyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    authorization,
    'x-amz-date': dateStr,
    'x-amz-content-sha256': payloadHash,
    host,
  };
}

// ─── Content-Type helpers ─────────────────────────────────────────────────────

function getContentType(path) {
  if (path.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (path.endsWith('.ts'))   return 'video/mp2t';
  return 'application/octet-stream';
}

function getCacheControl(path) {
  // TS segments are immutable once written — cache for 1 year
  if (path.endsWith('.ts'))   return 'public, max-age=31536000, immutable';
  // Manifests may change if video is re-transcoded — short cache
  if (path.endsWith('.m3u8')) return 'public, max-age=60';
  return 'public, max-age=3600';
}

// ─── Main Worker handler ──────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    // Only allow GET and HEAD
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(JSON.stringify({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(request.url);
    const pathname = url.pathname; // e.g. /video/abc123/master.m3u8

    // Route must start with /video/
    if (!pathname.startsWith('/video/')) {
      return new Response(JSON.stringify({ error: 'Not found', code: 'NOT_FOUND' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Map /video/{videoId}/{...} → B2 key: videos/{videoId}/{...}
    const b2Key = 'videos' + pathname.slice('/video'.length); // /video/abc/master.m3u8 → videos/abc/master.m3u8
    const b2Path = '/' + env.B2_BUCKET_NAME + '/' + b2Key.replace(/^\//, '');

    const endpoint = env.B2_ENDPOINT;
    const region = endpoint.split('.')[1]; // e.g. "us-east-005"

    // ── Check Cloudflare edge cache first ─────────────────────────────────────
    const cache = caches.default;
    const cacheKey = new Request(request.url, { method: 'GET' });
    const cached = await cache.match(cacheKey);
    if (cached) {
      const cachedResponse = new Response(cached.body, cached);
      cachedResponse.headers.set('Access-Control-Allow-Origin', '*');
      cachedResponse.headers.set('cf-cache-status', 'HIT');
      return cachedResponse;
    }

    // ── Sign the B2 request ───────────────────────────────────────────────────
    let signedHeaders;
    try {
      signedHeaders = await signS3Request({
        method: 'GET',
        host: endpoint,
        path: b2Path,
        region,
        keyId: env.B2_KEY_ID,
        secretKey: env.B2_APPLICATION_KEY,
      });
    } catch (err) {
      console.error('[worker] SigV4 signing failed:', err.message);
      return new Response(JSON.stringify({ error: 'Internal signing error', code: 'SIGN_ERROR' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // ── Fetch from B2 ─────────────────────────────────────────────────────────
    const b2Url = `https://${endpoint}${b2Path}`;
    let b2Response;
    try {
      b2Response = await fetch(b2Url, {
        method: 'GET',
        headers: {
          Authorization: signedHeaders.authorization,
          'x-amz-date': signedHeaders['x-amz-date'],
          'x-amz-content-sha256': signedHeaders['x-amz-content-sha256'],
          Host: endpoint,
        },
      });
    } catch (err) {
      console.error('[worker] B2 fetch failed:', err.message);
      return new Response(JSON.stringify({ error: 'Failed to reach storage', code: 'B2_UNREACHABLE' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // ── Handle B2 errors ──────────────────────────────────────────────────────
    if (b2Response.status === 404) {
      return new Response(JSON.stringify({ error: 'Video file not found', code: 'NOT_FOUND' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    if (!b2Response.ok) {
      console.error(`[worker] B2 returned ${b2Response.status} for key: ${b2Key}`);
      return new Response(JSON.stringify({ error: 'Storage error', code: 'B2_ERROR' }), {
        status: b2Response.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // ── Build response with correct headers ───────────────────────────────────
    const contentType = getContentType(pathname);
    const cacheControl = getCacheControl(pathname);

    const response = new Response(b2Response.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': cacheControl,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD',
        'Access-Control-Allow-Headers': 'Range',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
        'cf-cache-status': 'MISS',
        ...(b2Response.headers.get('content-length')
          ? { 'Content-Length': b2Response.headers.get('content-length') }
          : {}),
      },
    });

    // ── Store in Cloudflare edge cache (async, don't block response) ──────────
    ctx.waitUntil(cache.put(cacheKey, response.clone()));

    return response;
  },
};
