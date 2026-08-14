import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const videoId = formData.get('videoId') as string;
    const chunkIndexStr = formData.get('chunkIndex') as string;
    const chunkFile = formData.get('chunk') as File | null;

    if (!videoId || chunkIndexStr === null || !chunkFile) {
      return NextResponse.json({ error: 'Missing videoId, chunkIndex or chunk file' }, { status: 400 });
    }

    const chunkIndex = parseInt(chunkIndexStr, 10);
    const chunkDir = path.join(os.tmpdir(), `chunks_${videoId}`);
    fs.mkdirSync(chunkDir, { recursive: true });

    const chunkPath = path.join(chunkDir, `chunk_${String(chunkIndex).padStart(5, '0')}`);
    const bytes = await chunkFile.arrayBuffer();
    fs.writeFileSync(chunkPath, Buffer.from(bytes));

    return NextResponse.json({
      success: true,
      videoId,
      chunkIndex,
      bytesReceived: bytes.byteLength,
    });
  } catch (err: any) {
    console.error('[Upload Chunk Error]:', err);
    return NextResponse.json({ error: err.message || 'Failed to save chunk' }, { status: 500 });
  }
}
