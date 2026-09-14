'use client';

import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { StudioCanvas } from '@/components/studio/StudioCanvas';

function StudioInner() {
  const params = useParams<{ projectId: string }>();
  const search = useSearchParams();
  const workspaceId = search.get('workspaceId');
  const workflowId = search.get('workflowId');
  const projectId = params.projectId;

  if (!workspaceId || !projectId) {
    return (
      <main style={{ padding: 24 }} role="main">
        <h1>Studio（画布）</h1>
        <p role="alert">缺少 workspaceId 查询参数。请从项目页打开。</p>
      </main>
    );
  }

  return (
    <StudioCanvas workspaceId={workspaceId} projectId={projectId} workflowId={workflowId} />
  );
}

export default function ProjectStudioPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }} role="status">正在加载画布…</div>}>
      <StudioInner />
    </Suspense>
  );
}
