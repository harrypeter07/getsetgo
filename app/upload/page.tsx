'use client';

import { useState } from 'react';
import type { Metadata } from 'next';
import UploadForm from '@/components/upload/UploadForm';
import UploadProgress from '@/components/upload/UploadProgress';

export default function UploadPage() {
  const [jobId, setJobId] = useState<string | null>(null);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 md:py-12">
      <div className="mb-8">
        <h1 className="text-text-primary text-2xl md:text-3xl font-bold tracking-tight">
          Upload a Video
        </h1>
        <p className="mt-2 text-text-secondary text-sm">
          Your video will be automatically transcoded into multiple quality levels for adaptive streaming.
          Supports MP4, MOV, and WebM up to 500 MB.
        </p>
      </div>

      {/* Quality info cards */}
      {!jobId && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {['240p', '360p', '480p', '720p'].map((q, i) => (
            <div
              key={q}
              className="bg-surface border border-white/5 rounded-xl p-3 text-center"
            >
              <div className="text-accent font-bold text-base">{q}</div>
              <div className="text-text-secondary text-xs mt-0.5">
                {['~400kbps', '~800kbps', '~1.4Mbps', '~2.8Mbps'][i]}
              </div>
            </div>
          ))}
        </div>
      )}

      {jobId ? (
        <UploadProgress jobId={jobId} />
      ) : (
        <UploadForm onJobCreated={setJobId} />
      )}
    </div>
  );
}

