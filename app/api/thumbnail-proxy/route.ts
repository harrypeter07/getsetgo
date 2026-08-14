import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Proxy thumbnail images from the laptop server through Vercel.
 * This avoids the localtunnel/cloudflared interstitial page on mobile browsers
 * when loading <img src="https://xxxx.trycloudflare.com/thumbnail?file=...">
 *
 * Usage: /api/thumbnail-proxy?url=https://xxxx.trycloudflare.com/thumbnail?file=...
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get('url');

  if (!targetUrl) {
    return NextResponse.json({ error: 'Missing url param' }, { status: 400 });
  }

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        'bypass-tunnel-reminder'  : 'true',
        'ngrok-skip-browser-warning': 'true',
        'User-Agent'              : 'ShimpliProxy/1.0',
      },
      // 8 second timeout
      signal: AbortSignal.timeout(8000),
    });

    if (!upstream.ok) {
      return NextResponse.json({ error: `Upstream returned ${upstream.status}` }, { status: upstream.status });
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    const buffer      = await upstream.arrayBuffer();

    return new NextResponse(buffer, {
      status : 200,
      headers: {
        'Content-Type' : contentType,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
