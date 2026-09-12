'use client';

import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { StudioCanvas } from '@/components/studio/StudioCanvas';

function StudioInner() {
  const params = useParams<{ projectId: string }>();
  const search = useSearchParams();
  const workspaceId = search.get('workspaceId');
  const projectId = params.projectId;

  if (!workspaceId || !projectId) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Studio</h1>
        <p>Missing workspaceId query param. Open from a project page.</p>
      </div>
    );
  }

  return <StudioCanvas workspaceId={workspaceId} projectId={projectId} />;
}

export default function ProjectStudioPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading studio…</div>}>
      <StudioInner />
    </Suspense>
  );
}
