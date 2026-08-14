# Shimpli 🎬

**Shimpli** is a high-performance, Netflix-style Adaptive Bitrate (HLS) video streaming web application built with Next.js, Cloudflare Workers, Backblaze B2, and Supabase.

## 🚀 Key Features

- **Adaptive Bitrate Streaming (HLS)**: Automatically switches quality between 360p, 480p, and 720p HD based on real-time internet connection speed.
- **Hardware-Accelerated Transcoding**: Powered by FFmpeg with AMD GPU (`h264_amf`) acceleration & parallel multi-quality encoding.
- **Netflix-Style Video Player**:
  - Auto-hiding control panel
  - Phone / Mobile Landscape Orientation Rotate button (`screen.orientation.lock('landscape')`)
  - Unified Settings menu (Quality, Playback Speed 0.25× to 2×, Audio Track selection)
  - Netflix Red progress bar with hover scrub preview
  - Keyboard shortcuts (`Space`, `F`, `M`, `←`, `→`)
- **Part & Episode Navigation**: Multi-part series navigation for seamless episode viewing.
- **Low-Bandwidth Data Saver**: Built-in 1-tap Data Saver mode.

## 🛠 Tech Stack

- **Frontend & SSR**: Next.js 14 (App Router, React Server Components, ISR)
- **Styling**: Tailwind CSS, Glassmorphic UI, Inter & Outfit fonts
- **Database**: Supabase (PostgreSQL)
- **Storage**: Backblaze B2 (Private bucket)
- **CDN / Edge Proxy**: Cloudflare Workers
- **Transcoder**: FFmpeg (AMD AMF GPU accelerated)