# SETUP GUIDE — Backblaze B2 (Private) + Cloudflare Worker Proxy
### No credit card required anywhere in this setup

This replaces Cloudflare R2 in the original plan. B2's public bucket option asks for a card; the private bucket does not. This guide sets up a private B2 bucket + a free Cloudflare Worker that acts as an authenticated proxy/CDN in front of it, so your app never exposes B2 credentials to the browser and never needs a public bucket.

---

## PART 1 — Backblaze B2 setup

1. Go to backblaze.com → Sign Up → **B2 Cloud Storage** (not the backup product). No card needed at signup.
2. Once in the dashboard: **Buckets → Create a Bucket**.
3. Bucket name: must be globally unique (e.g. `hassan-videostream-<random suffix>`).
4. **Files in Bucket are: Private.** (Leave Public unselected — that's the one that asks for a card.)
5. Create the bucket. Note the **Bucket ID** and **Bucket Name** shown in the dashboard — you'll need both.
6. Go to **App Keys** (left sidebar) → **Add a New Application Key**.
   - Name: `videostream-worker-key`
   - Allow access to: select your specific bucket (not "all buckets" — scope it down)
   - Type of Access: Read and Write
   - Create Key.
7. **Copy immediately and store safely** — B2 shows the `applicationKeyId` and `applicationKey` (secret) only once:
   - `keyID` → this is your B2 access key ID
   - `applicationKey` → this is your B2 secret key
8. Note your B2 **endpoint** — shown in the bucket details, looks like `s3.us-west-004.backblazeb2.com` (region varies).

**You now have 4 values to save:** `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET_NAME`, `B2_ENDPOINT`. Keep these out of any committed code — they go into Worker secrets (Part 3) and your Next.js `.env.local`.

---

## PART 2 — Cloudflare account (Workers only, no billing needed)

1. Go to cloudflare.com → Sign Up. Free account, no card required for the Workers free plan.
2. Dashboard → **Workers & Pages** → **Create** → **Create Worker**.
3. Give it a name, e.g. `videostream-proxy`. Deploy the default "Hello World" template first just to confirm it's live at `videostream-proxy.<your-subdomain>.workers.dev`.
4. Install Wrangler locally (Cloudflare's CLI) in your project or a separate `worker/` folder:
   ```bash
   npm install -g wrangler
   wrangler login
   ```
5. In your repo, create a `worker/` directory (separate from the Next.js app — it deploys independently):
   ```
   worker/
     src/index.js
     wrangler.toml
   ```

---

## PART 3 — Wrangler config + secrets

**`worker/wrangler.toml`:**
```toml
name = "videostream-proxy"
main = "src/index.js"
compatibility_date = "2025-01-01"

[vars]
B2_BUCKET_NAME = "your-bucket-name"
B2_ENDPOINT = "s3.us-west-004.backblazeb2.com"
```

Secrets (never in `wrangler.toml`, set via CLI so they're encrypted):
```bash
cd worker
wrangler secret put B2_KEY_ID
wrangler secret put B2_APPLICATION_KEY
```
(It'll prompt you to paste each value — paste the ones you saved in Part 1.)

---

## PART 4 — Deploy and verify

```bash
cd worker
wrangler deploy
```

This gives you a live URL: `https://videostream-proxy.<your-subdomain>.workers.dev`

Test it can reach B2 (after Phase 2 file is implemented — see the companion prompt file):
```bash
curl -I https://videostream-proxy.<your-subdomain>.workers.dev/video/test-id/master.m3u8
```
Expect a `200` with `content-type: application/vnd.apple.mpegurl` once a real file has been uploaded to B2 at that path.

---

## PART 5 — Wire it into the Next.js app

In `.env.local` (Next.js side — this is what the upload/transcode scripts use to talk to B2 directly, since server-side upload doesn't need the Worker):
```
B2_KEY_ID=xxxxx
B2_APPLICATION_KEY=xxxxx
B2_BUCKET_NAME=xxxxx
B2_ENDPOINT=s3.us-west-004.backblazeb2.com
NEXT_PUBLIC_STREAM_BASE_URL=https://videostream-proxy.<your-subdomain>.workers.dev
```

The **upload script** (`scripts/upload-to-b2.js`) uploads directly to B2 using the S3-compatible SDK with these credentials — this part never touches the Worker, it's a direct authenticated server-side connection.

The **player** (`VideoPlayer.tsx`) requests videos through `NEXT_PUBLIC_STREAM_BASE_URL` — this is the only URL the browser ever sees. It never sees raw B2 credentials or a raw B2 URL.

---

## PART 6 — Sanity checklist before moving on

- [ ] B2 bucket exists and is set to **Private**
- [ ] Application key created, scoped to that one bucket only
- [ ] Worker deployed and reachable at its `.workers.dev` URL
- [ ] Worker secrets set via `wrangler secret put` (not hardcoded, not in `wrangler.toml`, not committed to git)
- [ ] `.env.local` has all 4 B2 values + the Worker base URL, and `.env.local` is in `.gitignore`
- [ ] No credit card was entered anywhere in this process
