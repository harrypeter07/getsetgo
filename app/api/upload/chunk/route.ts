import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    let videoId: string | null = null;
    let chunkIndexStr: string | null = null;
    let buffer: Buffer | null = null;

    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      videoId = formData.get('videoId') as string;
      chunkIndexStr = formData.get('chunkIndex') as string;
      const chunkFile = formData.get('chunk') as File | null;
      if (chunkFile) {
        const ab = await chunkFile.arrayBuffer();
        buffer = Buffer.from(ab);
      }
    } else {
      videoId = req.headers.get('x-video-id');
      chunkIndexStr = req.headers.get('x-chunk-index');
      const ab = await req.arrayBuffer();
      buffer = Buffer.from(ab);
    }

    if (!videoId || chunkIndexStr === null || !buffer) {
      return NextResponse.json({ error: 'Missing videoId, chunkIndex or chunk body' }, { status: 400 });
    }

    const chunkIndex = parseInt(chunkIndexStr, 10);
    const chunkDir = path.join(os.tmpdir(), `chunks_${videoId}`);
    fs.mkdirSync(chunkDir, { recursive: true });

    const chunkPath = path.join(chunkDir, `chunk_${String(chunkIndex).padStart(5, '0')}`);
    fs.writeFileSync(chunkPath, buffer);

    return NextResponse.json({
      success: true,
      videoId,
      chunkIndex,
      bytesReceived: buffer.byteLength,
    });
  } catch (err: any) {
    console.error('[Upload Chunk Error]:', err);
    return NextResponse.json({ error: err.message || 'Failed to save chunk' }, { status: 500 });
  }
}
