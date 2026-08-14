# FOLLOW-UP PROMPT — Storage Architecture Change (Read After Master Prompt v2)

Paste this to the same coding agent AFTER it has already received `adaptive-streaming-agent-prompt-v2.md`. This corrects the storage layer.

---

## IMPORTANT — ARCHITECTURE CORRECTION

**Do not use Cloudflare R2 or any Cloudflare object storage bucket.** R2 requires adding a credit card even on its free tier. We are not using it.

**Use this instead:** Backblaze B2 (S3-compatible object storage, private bucket, no credit card) sitting behind a Cloudflare Worker that acts as an authenticated proxy. The Worker is a separate free product from R2 — Workers themselves don't require a card, only R2 storage does. So: **Cloudflare is still involved, but only as a compute/proxy layer (Worker), never as the storage bucket.**

Everywhere the v2 prompt said "R2" or "Cloudflare bucket," substitute the following. Setup steps (account creation, bucket creation, Worker deployment) are in the companion file `SETUP-GUIDE-b2-cloudflare-worker.md` — assume that has already been done manually and these 4 env vars + 1 Worker URL already exist:

```
B2_KEY_ID
B2_APPLICATION_KEY
B2_BUCKET_NAME
B2_ENDPOINT
NEXT_PUBLIC_STREAM_BASE_URL   (the deployed Worker's .workers.dev URL)
```

---

## REVISED PHASE 2 — Upload to B2 (replaces the old "upload-to-r2.js" spec)

**File:** `scripts/upload-to-b2.js`

```ts
/**
 * Uploads a transcoded HLS output directory to a PRIVATE Backblaze B2 bucket,
 * preserving folder structure so manifest relative paths still resolve.
 * @param localDir - directory containing master.m3u8 + quality subfolders
 * @param videoId - used as the B2 key prefix
 * @returns the base path (NOT a public URL — bucket is private) the app will
 *          combine with the Worker base URL to build playable URLs
 */
async function uploadHLSToB2(localDir: string, videoId: string): Promise<{
  b2KeyPrefix: string;        // e.g. "videos/{videoId}/"
  totalBytesUploaded: number;
  fileCount: number;
}>
```

**Rules:**
- Use the AWS S3 SDK (`@aws-sdk/client-s3`) pointed at B2's S3-compatible endpoint (`B2_ENDPOINT` env var), since B2 supports the S3 API — same SDK as before, just different endpoint + credentials + **no public ACL setting** (bucket-level privacy handles that, don't try to set per-object public ACLs, B2 doesn't need it and it may error).
- Key structure stays identical to before: `videos/{videoId}/master.m3u8`, `videos/{videoId}/{quality}/playlist.m3u8`, `videos/{videoId}/{quality}/seg_XXX.ts`.
- Set `ContentType` explicitly per file type on upload — same as before: `application/vnd.apple.mpegurl` for `.m3u8`, `video/mp2t` for `.ts`. This matters even more now since the Worker will pass this header through and hls.js depends on it.
- Concurrency cap of 6 parallel uploads, retry each file up to 3 times — unchanged from before.
- **Do not attempt to make the bucket or any object public.** It stays private. Public access happens only through the Worker, which authenticates server-side.
- On completion, save `b2KeyPrefix` to the `videos` table (add/rename the column from `master_manifest_url` to `manifest_path` — it's now a relative path, not a full public URL, since the actual URL is constructed at request time as `${NEXT_PUBLIC_STREAM_BASE_URL}/${manifest_path}`).

**Testing:**
- [ ] Confirm objects land in B2 dashboard under the expected key structure
- [ ] Confirm bucket remains Private in B2 dashboard (didn't get flipped by any SDK call)
- [ ] Attempt to fetch a B2 object URL directly (no Worker) → should fail/be unauthorized, confirming it's actually private

---

## NEW COMPONENT — Cloudflare Worker proxy

**File:** `worker/src/index.js`

This is a standalone deployable unit (deployed via `wrangler deploy`, not part of the Next.js build). Its only job: receive a request for a video file path, authenticate to B2 using AWS Signature V4 (since B2's S3-compatible API needs signed requests for private objects), fetch it, stream it back with correct headers, and let Cloudflare's edge cache it.

```ts
/**
 * Cloudflare Worker fetch handler.
 * Route pattern: GET /video/{videoId}/{...path}
 * e.g. /video/abc123/master.m3u8
 *      /video/abc123/480p/seg_003.ts
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>
}
```

**Requirements:**
- Parse the path after `/video/` and map it to the B2 object key `videos/{videoId}/{...path}`.
- Sign the request to B2 using SigV4 (use a lightweight signing library compatible with Workers runtime — `aws4fetch` is the standard choice for Workers since the full AWS SDK doesn't run in the Workers runtime).
- Forward B2's response body and status through to the client.
- Explicitly set/pass through `Content-Type` correctly for `.m3u8` (`application/vnd.apple.mpegurl`) and `.ts` (`video/mp2t`) — don't trust B2's returned content-type blindly, override it based on file extension as a safety net.
- Set caching headers on the response: `Cache-Control: public, max-age=31536000, immutable` for `.ts` segments (they never change once written), and `Cache-Control: public, max-age=60` for `.m3u8` manifests (short cache, in case of re-transcodes).
- Use `caches.default` (Cloudflare's Cache API) inside the Worker to explicitly cache responses at the edge, keyed by the full request URL — this is what gives you free CDN-like behavior.
- Handle 404 from B2 cleanly → return a `404` with a small JSON body, not a raw B2 error passthrough.
- CORS: add `Access-Control-Allow-Origin` header (your Next.js app's origin, or `*` for now since it's read-only video data) so the browser's hls.js can fetch cross-origin from the Worker domain.

**Testing:**
- [ ] `curl -I` a known-uploaded `.m3u8` path through the Worker URL → `200`, correct `Content-Type`
- [ ] `curl -I` a `.ts` segment through the Worker → `200`, correct `Content-Type`, `Cache-Control` header present
- [ ] Second identical request → check `cf-cache-status: HIT` header (confirms edge caching is working)
- [ ] Request a nonexistent video/path → clean `404`, not a stack trace or raw AWS XML error
- [ ] Load the actual `/watch/[id]` page with hls.js pointed at the Worker URL → confirms end-to-end playback works through the proxy, not just curl-level checks

---

## UPDATED PLAYER CONFIG

In `VideoPlayer.tsx`, the manifest URL is now constructed client-side, not stored as a full URL:
```ts
const manifestUrl = `${process.env.NEXT_PUBLIC_STREAM_BASE_URL}/video/${videoId}/master.m3u8`;
```
Everything else about hls.js config from the v2 prompt (buffer settings, ABR, data saver cap) stays unchanged — only the URL source changes.

---

## UPDATED DEFINITION OF DONE (additions to v2's list)

11. B2 bucket confirmed private in dashboard, no credit card was ever entered.
12. Worker successfully proxies both manifest and segment requests with correct content-types and cache headers.
13. Second request to the same segment shows `cf-cache-status: HIT` — edge caching confirmed working.
14. B2 credentials (`B2_KEY_ID`, `B2_APPLICATION_KEY`) exist only as Worker secrets and Next.js server-side env vars — never appear in any client-side bundle or committed file. Verify by searching the built `.next` output for the key string — it must not appear.
