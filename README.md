# Netchinga — Adaptive Low-Bandwidth Video Streaming

A full-stack video streaming platform that transcodes uploaded videos into multi-quality HLS format and delivers them with adaptive bitrate streaming via hls.js.

## Features

- 🎬 **Upload videos** up to 500MB (MP4, MOV, WebM)
- ⚙️ **Auto-transcoding** into 240p/360p/480p/720p/1080p HLS via FFmpeg
- ☁️ **Cloudflare R2** storage for HLS segments
- 📱 **Mobile-first** adaptive player with quality selector bottom sheet
- 🌐 **Adaptive bitrate** — hls.js automatically picks quality based on bandwidth
- 💾 **Data Saver mode** — caps quality at 480p
- 🔒 **Manual quality lock** — pin to a specific quality level

## Prerequisites

- **Node.js** v18+
- **FFmpeg** installed and in PATH (`ffmpeg -version` should work)
- **Supabase** account and project
- **Cloudflare R2** bucket configured for public access

## Setup

1. **Clone and install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env.local
   # Fill in your Supabase and R2 credentials
   ```

3. **Set up the database:**
   - Go to your Supabase project → SQL Editor
   - Run the contents of `docs/supabase-schema.sql`

4. **Set up Cloudflare R2:**
   - See `docs/COMPUTE_ENVIRONMENT.md` for step-by-step instructions

5. **Run the development server:**
   ```bash
   npm run dev
   ```

## Usage

| URL | Description |
|-----|-------------|
| `http://localhost:3000` | Browse all videos |
| `http://localhost:3000/upload` | Upload a new video |
| `http://localhost:3000/watch/[id]` | Watch a video |

## Scripts

```bash
npm run dev                              # Start dev server
npm run test:transcode                   # Run transcode tests
npm run transcode <input> <outputDir>    # Transcode a video manually
npm run upload-to-r2 <dir> <videoId>    # Upload HLS output to R2
```

## Architecture

See [`adaptive-streaming-agent-prompt-v2.md`](./adaptive-streaming-agent-prompt-v2.md) for the full system architecture.

## Project Structure

```
/app
  /watch/[id]/page.tsx       # Video watch page
  /upload/page.tsx           # Video upload page
  /api/upload/route.ts       # POST — accept upload, start pipeline
  /api/videos/[id]/route.ts  # GET — video metadata
  /api/upload-status/[jobId]/route.ts  # GET — job status polling
/components
  /player/VideoPlayer.tsx    # hls.js player
  /player/Controls.tsx       # Player controls + utility functions
  /player/QualitySelector.tsx # Bottom sheet / dropdown
  /player/ProgressBar.tsx    # Touch-expandable seek bar
  /player/VolumeControl.tsx  # Volume slider
  /player/BufferingSpinner.tsx # Loading indicator
  /upload/UploadForm.tsx     # Upload form with drag-and-drop
  /upload/UploadProgress.tsx # Stage-aware progress tracker
/lib
  /types.ts                  # Shared TypeScript types
  /supabase-client.ts        # Supabase helpers
  /r2-client.ts              # R2 upload helpers
/scripts
  /transcode.js              # FFmpeg HLS transcoder
  /upload-to-r2.js           # R2 upload pipeline
/tests
  /transcode.test.js         # Transcode unit tests
  /player.manual-test-checklist.md
/docs
  /COMPUTE_ENVIRONMENT.md    # Actual compute environment docs
  /supabase-schema.sql       # Database schema
```

## Compute Environment

All transcoding runs locally on CPU via FFmpeg. No GPU or cloud transcoding is claimed.
See `docs/COMPUTE_ENVIRONMENT.md` for details.
