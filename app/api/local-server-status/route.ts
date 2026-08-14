import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase-client';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
  try {
    const statusId = '00000000-0000-0000-0000-000000000000';
    const { data, error } = await supabase
      .from('videos')
      .select('*')
      .eq('id', statusId)
      .single();

    if (error || !data) {
      return NextResponse.json({ connected: false, status: 'offline' }, { status: 200 });
    }

    const lastSeen = new Date(data.created_at).getTime();
    const now = Date.now();
    const isAlive = (now - lastSeen) < 45000; // Heartbeat valid within 45 seconds

    let meta = { videoCount: 0, targetFolder: 'C:\\ShimpliVideos' };
    try {
      if (data.description) meta = JSON.parse(data.description);
    } catch {}

    return NextResponse.json({
      connected: isAlive,
      status: isAlive ? 'online' : 'offline',
      publicBaseUrl: data.master_manifest_url,
      videoCount: meta.videoCount || 0,
      targetFolder: meta.targetFolder || 'C:\\ShimpliVideos',
      lastSeenSecondsAgo: Math.round((now - lastSeen) / 1000),
    }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ connected: false, status: 'offline', error: err.message }, { status: 200 });
  }
}
