import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic   = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

// Create a fresh Supabase client per request with no caching
function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key, {
    auth  : { persistSession: false },
    global: {
      headers: {
        // Prevent any Supabase CDN/proxy caching
        'Cache-Control': 'no-store, no-cache',
        'Pragma'       : 'no-cache',
      },
    },
  });
}

export async function GET(request: NextRequest) {
  const responseHeaders = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma'       : 'no-cache',
    'Expires'      : '0',
  };

  try {
    const supabase = getSupabase();

    // Use .limit(1) + filter to bypass any query caching layer
    const { data: rows, error } = await supabase
      .from('videos')
      .select('id, title, status, master_manifest_url, description, created_at')
      .eq('id', '00000000-0000-0000-0000-000000000000')
      .limit(1);

    const data = rows?.[0] ?? null;

    if (error || !data) {
      return NextResponse.json(
        { connected: false, status: 'offline', videos: [], reason: error?.message || 'No data' },
        { status: 200, headers: responseHeaders }
      );
    }

    // Parse heartbeat payload
    let meta: any = { videoCount: 0, targetFolder: 'C:\\ShimpliVideos', videos: [], serverTimestamp: null };
    try {
      if (data.description) meta = JSON.parse(data.description);
    } catch {}

    // Freshness: prefer serverTimestamp in payload (set by local-server.js), fallback to created_at
    const timestampStr = meta.serverTimestamp || data.created_at;
    const lastSeen     = new Date(timestampStr).getTime();
    const ageSeconds   = Math.round((Date.now() - lastSeen) / 1000);
    const isAlive      = ageSeconds < 60; // alive if heartbeat within 60 seconds

    // Rewrite thumbnail URLs through our Vercel proxy to bypass tunnel interstitial pages
    const host       = request.headers.get('host') || 'shimpli.vercel.app';
    const protocol   = host.startsWith('localhost') ? 'http' : 'https';
    const vercelBase = `${protocol}://${host}`;

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
      activeClients     : meta.activeClients || [],
      lastSeenSecondsAgo: ageSeconds,
      _dbStatus         : data.status,
      _timestampUsed    : timestampStr,
      _ageSeconds       : ageSeconds,
    }, { status: 200, headers: responseHeaders });

  } catch (err: any) {
    return NextResponse.json(
      { connected: false, status: 'offline', videos: [], error: err.message },
      { status: 200, headers: responseHeaders }
    );
  }
}
