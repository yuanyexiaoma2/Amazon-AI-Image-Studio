'use client';

import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { StudioCanvas } from '@/components/studio/StudioCanvas';
import { ErrorBanner } from '@/components/ui';

function StudioInner() {
  const params = useParams<{ projectId: string }>();
  const search = useSearchParams();
  const workspaceId = search.get('workspaceId');
  const workflowId = search.get('workflowId');
  const projectId = params.projectId;

  if (!workspaceId || !projectId) {
    return (
      <main className="container" role="main">
        <h1>Studio（画布）</h1>
        <ErrorBanner message="缺少 workspaceId 查询参数。请从项目页打开。" />
      </main>
    );
  }

  return (
    <StudioCanvas workspaceId={workspaceId} projectId={projectId} workflowId={workflowId} />
  );
}

export default function ProjectStudioPage() {
  return (
    <Suspense fallback={<div className="container" role="status">正在加载画布…</div>}>
      <StudioInner />
    </Suspense>
  );
}
