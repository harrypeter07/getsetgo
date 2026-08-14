# MASTER PROMPT v2 — Adaptive Low-Bandwidth Video Streaming Platform
### (Full spec: architecture, function contracts, mobile-first UI system, testing, rules)

Feed this to the coding agent phase by phase. Each phase has explicit function signatures, file paths, and a "DONE WHEN" checklist — the agent should not move to the next phase until every checklist item in the current phase passes.

---

## 0. NON-NEGOTIABLE RULES (apply to every phase)

1. **Mobile-first, always.** Design and build for a 375px-wide viewport first, then scale up. Every component must be manually verified at 375px, 768px, and 1440px before it's considered done. Touch targets minimum 44x44px. No hover-only interactions — every hover state needs a tap equivalent.
2. **No silent failures.** Every async operation (transcode, upload, fetch, playback) must have an explicit error state with a user-visible message. No unhandled promise rejections.
3. **No component over 150 lines.** Split further if it grows past that.
4. **Every API route needs input validation** (zod schema) and returns typed JSON errors: `{ error: string, code: string }`.
5. **Commit after every phase**, not every file. One clean commit per phase with a message describing what now works.
6. **Log the real compute environment** used for transcoding (local machine / CI runner / cloud VM) in `docs/COMPUTE_ENVIRONMENT.md` — never assume or claim GPU/cloud processing that isn't actually happening.
7. **Don't build custom ABR logic.** hls.js's built-in bandwidth estimator handles quality switching — configure it, don't replace it.

---

## 1. SYSTEM ARCHITECTURE

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Upload UI   │────▶│ POST /api/upload  │────▶│  /tmp raw file    │
└─────────────┘     └──────────────────┘     └─────────────────┘
                                                        │
                                                        ▼
                                          ┌──────────────────────────┐
                                          │ scripts/transcode.js      │
                                          │ FFmpeg → HLS multi-quality│
                                          └──────────────────────────┘
                                                        │
                                                        ▼
                                          ┌──────────────────────────┐
                                          │ scripts/upload-to-r2.js   │
                                          │ pushes chunks+manifests   │
                                          └──────────────────────────┘
                                                        │
                                                        ▼
                                   ┌──────────────────────────────────┐
                                   │ Cloudflare R2 (public bucket)     │
                                   │ /{videoId}/master.m3u8            │
                                   │ /{videoId}/{quality}/playlist.m3u8│
                                   │ /{videoId}/{quality}/seg_%03d.ts  │
                                   └──────────────────────────────────┘
                                                        │
                       ┌────────────────────────────────┘
                       ▼
          ┌─────────────────────────┐
          │ Supabase: videos table   │──▶ stores manifest URL + metadata
          └─────────────────────────┘
                       │
                       ▼
          ┌─────────────────────────┐      ┌───────────────────┐
          │ GET /api/videos/[id]     │─────▶│ /watch/[id] page   │
          └─────────────────────────┘      └───────────────────┘
                                                     │
                                                     ▼
                                        ┌─────────────────────────┐
                                        │ VideoPlayer (hls.js)     │
                                        │ + Controls + Quality UI  │
                                        └─────────────────────────┘
```

---

## 2. DATABASE SCHEMA (Supabase / Postgres)

```sql
create table videos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  duration_seconds integer,
  master_manifest_url text not null,
  available_qualities text[] not null,        -- e.g. ['240p','360p','480p','720p']
  thumbnail_url text,
  status text not null default 'processing',   -- 'processing' | 'ready' | 'failed'
  transcode_log jsonb,                          -- stores compute env, ffmpeg version, timings
  created_at timestamptz default now(),
  view_count integer default 0
);

create table upload_jobs (
  id uuid primary key default gen_random_uuid(),
  video_id uuid references videos(id),
  status text not null default 'queued',        -- 'queued' | 'transcoding' | 'uploading' | 'done' | 'error'
  error_message text,
  progress_percent integer default 0,
  updated_at timestamptz default now()
);
```

---

## 3. REPO STRUCTURE (exact)

```
/app
  /watch/[id]/page.tsx
  /upload/page.tsx
  /api/upload/route.ts
  /api/videos/[id]/route.ts
  /api/upload-status/[jobId]/route.ts
/components
  /player/VideoPlayer.tsx
  /player/Controls.tsx
  /player/QualitySelector.tsx
  /player/ProgressBar.tsx
  /player/VolumeControl.tsx
  /player/BufferingSpinner.tsx
  /upload/UploadForm.tsx
  /upload/UploadProgress.tsx
/lib
  /r2-client.ts
  /supabase-client.ts
  /types.ts
/scripts
  /transcode.js
  /upload-to-r2.js
/tests
  /transcode.test.js
  /api-upload.test.ts
  /player.manual-test-checklist.md
/docs
  /COMPUTE_ENVIRONMENT.md
```

---

## 4. UI DESIGN SYSTEM (mobile-first — define before building any component)

**Breakpoints (Tailwind):** `base` = 0–639px (default, design here first) · `sm` = 640px · `md` = 768px · `lg` = 1024px

**Color tokens** (define in `tailwind.config.ts` under `theme.extend.colors`, don't hardcode hex in components):
```
background:   #0B0B0F   (near-black, video-first UI)
surface:      #17171C   (cards, control bar background)
surface-alt:  #212127
accent:       #E50914-alternative → use #4F8CFF (electric blue, avoid literal Netflix red for originality)
text-primary:   #FFFFFF
text-secondary: #A0A0AB
danger:       #FF5C5C
```

**Typography:** System font stack for speed (`font-sans` default Tailwind stack) — no custom font import, it's dead weight for a low-bandwidth-focused product. Base size 14px mobile / 16px desktop.

**Spacing:** Use Tailwind's default scale only (4px increments). No arbitrary values like `mt-[13px]`.

**Player control bar (mobile):**
- Fixed to bottom of video, full width, height 56px, semi-transparent dark gradient background (not solid) so it overlays video without a hard cut
- Icon-only buttons (no text labels) at this width: play/pause, mute toggle, quality gear icon, fullscreen
- Progress bar sits ABOVE the control row as a separate 4px-tall touch-expandable strip (expands to 12px hit-area on touch)
- Quality selector opens as a bottom sheet on mobile (not a dropdown — dropdowns are unreliable on mobile Safari), full-width, tap to select, closes on selection

**Player control bar (desktop, ≥768px):**
- Single row: play/pause, volume slider (horizontal, revealed on hover of speaker icon), progress bar, time display, quality gear (opens small dropdown), fullscreen

---

## 5. PHASE 1 — TRANSCODE SCRIPT

**File:** `scripts/transcode.js`

**Function contract:**
```ts
/**
 * Transcodes a source video into multi-quality HLS output.
 * @param inputPath - absolute path to source video file
 * @param outputDir - directory to write {quality}/playlist.m3u8 + segments + master.m3u8
 * @returns metadata about what was generated
 */
async function transcodeToHLS(inputPath: string, outputDir: string): Promise<{
  qualities: Array<{ label: string; width: number; height: number; bitrateKbps: number }>;
  masterManifestPath: string;
  durationSeconds: number;
  ffmpegVersion: string;
  transcodeTimeMs: number;
}>
```

**Rules:**
- Detect source resolution first (via `ffprobe`); only generate quality renditions ≤ source resolution — never upscale.
- Quality ladder to attempt (skip any above source): `240p@400kbps`, `360p@800kbps`, `480p@1400kbps`, `720p@2800kbps`, `1080p@5000kbps`.
- Segment duration: exactly 6 seconds (`-hls_time 6`), segment type `.ts`.
- Master manifest must include `BANDWIDTH` and `RESOLUTION` tags per variant (required for hls.js ABR to function).
- Exact ffmpeg command pattern per quality (example for 480p):
```bash
ffmpeg -i input.mp4 -vf scale=w=-2:h=480 -c:a aac -ar 48000 -b:a 96k \
  -c:v h264 -profile:v main -crf 20 -sc_threshold 0 -g 48 -keyint_min 48 \
  -hls_time 6 -hls_playlist_type vod -b:v 1400k -maxrate 1498k -bufsize 2100k \
  -hls_segment_filename '480p/seg_%03d.ts' 480p/playlist.m3u8
```
- After all renditions generated, write `master.m3u8` referencing each `{quality}/playlist.m3u8` with correct `#EXT-X-STREAM-INF:BANDWIDTH=...,RESOLUTION=...` lines.
- On any ffmpeg non-zero exit: throw with the captured stderr, don't swallow it.
- Write timing + environment info (hostname, node version, ffmpeg version, whether run locally/CI) to the returned object — this gets persisted to `transcode_log` in the DB.

**Testing (must pass before Phase 2):**
- [ ] Run on a real test video (provide a ~30s 720p sample) → confirm output folder has all expected quality subfolders
- [ ] `ffprobe` each generated `.ts` segment confirms correct resolution/bitrate per quality
- [ ] Play `master.m3u8` locally in VLC → confirm playback works and VLC's stats show multiple available quality tracks
- [ ] Corrupt/invalid input file → function throws a clear error, doesn't hang or crash silently
- [ ] Very short video (<6 sec, shorter than one segment) → handle gracefully, doesn't crash

---

## 6. PHASE 2 — R2 UPLOAD

**File:** `scripts/upload-to-r2.js`

```ts
/**
 * Uploads a transcoded HLS output directory to R2, preserving structure.
 * @param localDir - directory containing master.m3u8 + quality subfolders
 * @param videoId - used as the R2 key prefix
 * @returns public URL of the master manifest
 */
async function uploadHLSToR2(localDir: string, videoId: string): Promise<{
  masterManifestUrl: string;
  totalBytesUploaded: number;
  fileCount: number;
}>
```

**Rules:**
- R2 key structure: `{videoId}/{quality}/seg_XXX.ts` and `{videoId}/{quality}/playlist.m3u8` and `{videoId}/master.m3u8` — must exactly mirror local structure so relative paths in manifests resolve without rewriting them.
- Set `Content-Type: application/vnd.apple.mpegurl` for `.m3u8` files and `video/mp2t` for `.ts` files explicitly — R2 won't infer these correctly by default and wrong content-type breaks hls.js in some browsers.
- Upload in parallel with a concurrency cap of 6 (don't fire all requests at once, don't do them fully sequentially either).
- Retry each individual file upload up to 3 times on failure before aborting the whole job.
- Bucket must be configured for public read access; document the exact R2 dashboard steps in `docs/COMPUTE_ENVIRONMENT.md`.

**Testing:**
- [ ] After upload, fetch the master manifest URL directly via curl/browser → confirms public accessibility
- [ ] Fetch one `.ts` segment directly → confirm correct `Content-Type` header in response
- [ ] Kill network mid-upload (simulate) → confirm retry logic kicks in and job either completes or fails cleanly with a logged reason

---

## 7. PHASE 3 — API ROUTES

**`POST /api/upload`**
- Request: `multipart/form-data` with `file` (video) and `title` (string)
- Validates: file size ≤ 500MB, mimetype in `['video/mp4','video/quicktime','video/webm']`
- Response `202`: `{ jobId: string }`
- Process: saves file to `/tmp`, creates `upload_jobs` row (`status: 'queued'`), kicks off transcode → upload → DB update pipeline asynchronously (don't block the HTTP response on the full pipeline)

**`GET /api/upload-status/[jobId]`**
- Response: `{ status: 'queued'|'transcoding'|'uploading'|'done'|'error', progressPercent: number, videoId?: string, errorMessage?: string }`
- Frontend polls this every 2s while status is not terminal

**`GET /api/videos/[id]`**
- Response: `{ id, title, description, masterManifestUrl, availableQualities, durationSeconds, thumbnailUrl, status }`
- `404` with `{ error, code: 'VIDEO_NOT_FOUND' }` if missing

**Testing:**
- [ ] Upload a valid file → poll status → reaches `done` → video appears at `/watch/[id]`
- [ ] Upload an oversized file → rejected with clear `413`-style error, no partial job created
- [ ] Upload an unsupported format → rejected before transcode even starts
- [ ] Request a nonexistent video id → clean 404, not a crash

---

## 8. PHASE 4 — PLAYER

**`components/player/VideoPlayer.tsx`**
```ts
interface VideoPlayerProps {
  masterManifestUrl: string;
  poster?: string;
  onQualityChange?: (level: { label: string; height: number }) => void;
  dataSaverMode?: boolean; // caps max auto-quality
}
```

**hls.js config (exact):**
```js
new Hls({
  maxBufferLength: 30,          // don't over-buffer on constrained connections
  maxMaxBufferLength: 60,
  startLevel: -1,                // let hls.js pick starting quality based on initial bandwidth probe
  abrEwmaDefaultEstimate: 500000,// conservative 500kbps default assumption until real measurement kicks in
  capLevelToPlayerSize: true,    // don't stream 1080p into a 300px player
  maxAutoLevelCapping: dataSaverMode ? indexOfQuality('480p') : -1,
})
```

**Required event handling (don't skip any):**
- `Hls.Events.ERROR` → if `fatal`, attempt `hls.recoverMediaError()` once, then show error UI if it fails again
- `Hls.Events.LEVEL_SWITCHED` → update the visible "current quality" indicator, fire `onQualityChange`
- `Hls.Events.BUFFER_STALLED` → show `BufferingSpinner`
- Network-type detection via `navigator.connection?.effectiveType` (where supported) to pick a sane `startLevel` hint on load — not authoritative, just a hint, hls.js's own measurement still governs subsequent switches

**`components/player/Controls.tsx`** — must implement, as separate testable functions:
```ts
function formatTime(seconds: number): string        // "1:23:45" or "3:45"
function calculateBufferedPercent(video: HTMLVideoElement): number
function handleSeek(video: HTMLVideoElement, percent: number): void
```

**Testing (manual checklist in `tests/player.manual-test-checklist.md`):**
- [ ] Chrome DevTools → Network → "Slow 3G" → load `/watch/[id]` → video starts playing within 8 seconds at low quality
- [ ] Switch throttle to "No throttling" mid-playback → confirm quality auto-upgrades within ~15 seconds without restarting playback
- [ ] Manually select "240p" via quality selector → confirm it actually switches and stays locked (doesn't auto-override back)
- [ ] Toggle "Data Saver" → confirm quality never exceeds 480p even on fast connection
- [ ] Test on real mobile device (not just DevTools emulation) on actual mobile data/wifi throttled via OS-level tool or a slow café wifi — confirm touch controls, bottom-sheet quality selector, and no layout overflow at 375px
- [ ] Airplane mode mid-playback → confirm buffering spinner shows, then a clear "connection lost" message after ~10s, not an infinite spinner
- [ ] Rotate device orientation → player resizes correctly, controls remain usable

---

## 9. PHASE 5 — UPLOAD UI

**`components/upload/UploadForm.tsx`** — mobile-first: single-column form, large tap-friendly file picker button, title input, submit button min-height 48px.

**`components/upload/UploadProgress.tsx`** — polls `/api/upload-status/[jobId]`, shows a labeled progress bar with current stage text ("Transcoding 480p…", "Uploading to storage…") not just a raw percentage — users should know what's happening on slow connections where each stage can take a while.

---

## 10. DEFINITION OF DONE — MEASURABLE

Not "it works" — every item below must be individually verifiable:

1. `scripts/transcode.js` produces a valid master manifest with ≥3 quality levels for a 720p+ source video, verified via VLC.
2. `scripts/upload-to-r2.js` uploads with correct `Content-Type` headers, verified via curl `-I`.
3. Upload → status polling → playable video end-to-end, tested with a real file through the actual UI (not just API calls).
4. Player on Chrome DevTools "Slow 3G": first frame renders in ≤8s.
5. Player on real mobile device, real throttled network: quality selector bottom sheet opens/works, no horizontal scroll/overflow at 375px width.
6. Manual quality lock: selecting a quality prevents auto-switch until user selects "Auto" again.
7. Data Saver toggle demonstrably caps quality (verified by checking `hls.currentLevel` in console).
8. Killing network mid-playback shows a real error state within 10s, not an infinite spinner.
9. Every API route has been tested with both a valid and an invalid/edge-case request.
10. `docs/COMPUTE_ENVIRONMENT.md` accurately states what actually ran where — no unverified claims.
