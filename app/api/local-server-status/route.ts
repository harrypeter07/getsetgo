import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase-client';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const statusId = '00000000-0000-0000-0000-000000000000';
    const { data, error } = await supabase
      .from('videos')
      .select('*')
      .eq('id', statusId)
      .single();

    if (error || !data) {
      return NextResponse.json({ connected: false, status: 'offline', videos: [] }, { status: 200 });
    }

    const lastSeen = new Date(data.created_at).getTime();
    const now      = Date.now();
    const isAlive  = (now - lastSeen) < 45_000; // heartbeat valid within 45 seconds

    let meta: any = { videoCount: 0, targetFolder: 'C:\\ShimpliVideos', videos: [] };
    try {
      if (data.description) meta = JSON.parse(data.description);
    } catch {}

    // Build the base URL for the Vercel deployment (used for thumbnail proxy)
    const host       = request.headers.get('host') || 'shimpli.vercel.app';
    const protocol   = host.startsWith('localhost') ? 'http' : 'https';
    const vercelBase = `${protocol}://${host}`;

    // Rewrite thumbnail URLs through our Vercel proxy so mobile browsers
    // never hit the localtunnel/cloudflared interstitial page for images.
    // Stream URLs remain direct tunnel URLs (browsers send Range headers fine).
    const videos = (meta.videos || []).map((v: any) => ({
      ...v,
      // proxy thumbnail through Vercel edge so no interstitial
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
      lastSeenSecondsAgo: Math.round((now - lastSeen) / 1000),
    }, { status: 200 });

  } catch (err: any) {
    return NextResponse.json(
      { connected: false, status: 'offline', videos: [], error: err.message },
      { status: 200 }
    );
  }
}
