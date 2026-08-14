import type { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getVideoById, listVideos } from '@/lib/supabase-client';
import WatchClient from './WatchClient';
import type { Video } from '@/lib/types';

interface WatchPageProps {
  params: { id: string };
}

export async function generateMetadata({ params }: WatchPageProps): Promise<Metadata> {
  try {
    const video = await getVideoById(params.id);
    if (!video) return { title: 'Video Not Found' };
    return {
      title: `${video.title} — Shimpli Stream`,
      description: video.description ?? `Watch "${video.title}" in adaptive quality HLS.`,
      openGraph: {
        title: video.title,
        description: video.description ?? `Watch "${video.title}" in adaptive quality HLS.`,
        images: video.thumbnail_url ? [video.thumbnail_url] : [],
      },
    };
  } catch {
    return { title: 'Watch Video' };
  }
}

export default async function WatchPage({ params }: WatchPageProps) {
  const { id } = params;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) notFound();

  let video;
  let allVideos: Video[] = [];
  try {
    video = await getVideoById(id);
    allVideos = await listVideos(20);
  } catch (err) {
    console.error('[WatchPage] Failed to fetch video:', err);
    throw new Error('Failed to load video data');
  }

  if (!video) notFound();

  if (video.status === 'processing') {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <div className="w-16 h-16 rounded-2xl bg-accent/20 border border-accent/40 flex items-center justify-center mx-auto mb-4 shadow-glow-red">
          <svg className="animate-spin w-8 h-8 text-accent" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        </div>
        <h1 className="text-white text-2xl font-bold">{video.title}</h1>
        <p className="text-text-secondary mt-2 text-sm max-w-md mx-auto">
          This video is currently being transcoded into multi-quality HLS segments. It will be ready shortly.
        </p>
        <meta httpEquiv="refresh" content="5" />
      </div>
    );
  }

  if (video.status === 'failed') {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <div className="text-danger text-5xl mb-4">⚠️</div>
        <h1 className="text-white text-2xl font-bold">Processing Failed</h1>
        <p className="text-text-secondary mt-2 text-sm max-w-md mx-auto">
          There was an error processing &ldquo;{video.title}&rdquo;. Please try re-uploading the file.
        </p>
      </div>
    );
  }

  const streamBaseUrl = process.env.NEXT_PUBLIC_STREAM_BASE_URL || 'https://videostream-proxy.hassanmansuri570.workers.dev';

  return (
    <Suspense fallback={<div className="max-w-6xl mx-auto px-4 py-16 text-center text-text-secondary">Loading player engine...</div>}>
      <WatchClient
        video={{
          id: video.id,
          title: video.title,
          description: video.description,
          masterManifestUrl: `${streamBaseUrl}/video/${video.id}/master.m3u8`,
          availableQualities: video.available_qualities,
          durationSeconds: video.duration_seconds,
          thumbnailUrl: video.thumbnail_url,
          status: video.status,
        }}
        allVideos={allVideos}
      />
    </Suspense>
  );
}
