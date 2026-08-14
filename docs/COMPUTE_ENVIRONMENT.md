# Compute Environment

This file documents the actual compute environment used for video transcoding.
It is updated automatically by the transcode pipeline and must be accurate — no unverified claims.

---

## Transcoding Environment

| Property        | Value                              |
|-----------------|------------------------------------|
| Machine type    | Local developer machine (Windows)  |
| GPU             | None — CPU-only transcoding via FFmpeg |
| FFmpeg version  | 4.3.1 (detected at runtime)        |
| Node.js version | v22.14.0                           |
| OS              | Windows                            |
| Environment     | `local`                            |

> **Note**: This project does NOT claim GPU or cloud transcoding. All transcoding is performed on the local CPU using FFmpeg. The `transcode_log` field in the `videos` Supabase table stores the actual environment metadata (hostname, node version, ffmpeg version, transcode time) from each run.

---

## Cloudflare R2 Setup

### Creating the bucket

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → R2
2. Click **Create bucket** → name it (e.g., `netchinga-videos`)
3. Note your **Account ID** from the R2 overview page

### Making the bucket publicly accessible

1. Open your bucket → **Settings** → **Public Access**
2. Enable **Allow public access**
3. Your public URL will be: `https://pub-<hash>.r2.dev`
4. Add this as `R2_PUBLIC_URL` in your `.env.local`

### Creating API credentials

1. R2 → **Manage R2 API tokens** → **Create API token**
2. Grant: **Object Read & Write** for your bucket
3. Note **Access Key ID** and **Secret Access Key**
4. Set these in `.env.local` as `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`

### Required CORS configuration (for browser playback)

In R2 bucket settings → CORS, add:

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["Content-Type", "Content-Length"],
    "MaxAgeSeconds": 3600
  }
]
```

---

## Supabase Setup

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the schema from `docs/supabase-schema.sql`
3. Go to **Project Settings** → **API**
4. Copy **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
5. Copy **anon (public) key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## Environment Variables

See `.env.example` for the full list of required environment variables.

---

*Last updated: 2026-08-14 (project initialization)*
