import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// Create a fresh Supabase client directly (avoid any module-level singleton caching)
function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

export async function GET(request: NextRequest) {
  try {
    const supabase  = getSupabase();
    const statusId  = '00000000-0000-0000-0000-000000000000';

    const { data, error } = await supabase
      .from('videos')
      .select('*')
      .eq('id', statusId)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { connected: false, status: 'offline', videos: [], reason: error?.message },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // Parse description JSON — contains serverTimestamp written by local-server.js
    let meta: any = { videoCount: 0, targetFolder: 'C:\\ShimpliVideos', videos: [], serverTimestamp: null };
    try {
      if (data.description) meta = JSON.parse(data.description);
    } catch {}

    // Use serverTimestamp from payload (most reliable — doesn't depend on Supabase created_at RLS)
    // Fallback to created_at column if serverTimestamp missing (old server versions)
    const timestampStr = meta.serverTimestamp || data.created_at;
    const lastSeen     = new Date(timestampStr).getTime();
    const now          = Date.now();
    const ageSeconds   = Math.round((now - lastSeen) / 1000);
    const isAlive      = ageSeconds < 60; // consider alive if heartbeat within 60 seconds

    // Build the base URL for thumbnail proxy rewriting
    const host       = request.headers.get('host') || 'shimpli.vercel.app';
    const protocol   = host.startsWith('localhost') ? 'http' : 'https';
    const vercelBase = `${protocol}://${host}`;

    // Rewrite thumbnail URLs through Vercel proxy so mobile browsers
    // never hit the tunnel directly (avoids cloudflared/localtunnel interstitial)
    const videos = (meta.videos || []).map((v: any) => ({
      ...v,
      thumbnailUrl: v.thumbnailUrl
        ? `${vercelBase}/api/thumbnail-proxy?url=${encodeURIComponent(v.thumbnailUrl)}`
        : undefined,
    }));

    return NextResponse.json({
      connected         : isAlive,
      status            : isAlive ? 'online' : 'offline',
      publicBaseUrl     : data.master_manifest_url,
      videoCount        : meta.videoCount || 0,
      targetFolder      : meta.targetFolder || 'C:\\ShimpliVideos',
      videos,
      lastSeenSecondsAgo: ageSeconds,
      // debug info
      _dbStatus         : data.status,
      _timestampUsed    : timestampStr,
    }, {
      status : 200,
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });

  } catch (err: any) {
    return NextResponse.json(
      { connected: false, status: 'offline', videos: [], error: err.message },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
