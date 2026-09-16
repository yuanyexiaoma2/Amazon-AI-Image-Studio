'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { StudioCanvas } from '@/components/studio/StudioCanvas';
import { ProjectStepper } from '@/components/project-stepper';
import { ProjectSwitcher } from '@/components/project-switcher';
import { Spinner } from '@/components/ui';
import { useWorkspace } from '@/lib/use-workspace';

function StudioInner() {
  const params = useParams<{ projectId: string }>();
  const search = useSearchParams();
  const { workspaceId, loading: wsLoading } = useWorkspace();
  const workflowId = search.get('workflowId');
  const projectId = params.projectId;

  if (!workspaceId) {
    return (
      <main className="container" role="main">
        <h1>工作台（画布）</h1>
        {wsLoading ? (
          <Spinner label="正在解析工作空间…" />
        ) : (
          <p role="alert" className="banner-warn">
            无法解析工作空间 — 请先从 <Link href="/projects">项目列表</Link> 打开项目。
          </p>
        )}
      </main>
    );
  }

  return (
    <div>
      <div className="stepper-bar studio-topbar">
        <ProjectSwitcher workspaceId={workspaceId} projectId={projectId} />
        <ProjectStepper projectId={projectId} input={{ hasWorkflow: true }} />
      </div>
      <StudioCanvas
        workspaceId={workspaceId}
        projectId={projectId}
        workflowId={workflowId}
        belowStepper
      />
    </div>
  );
}

export default function ProjectStudioPage() {
  return (
    <Suspense fallback={<div className="container" role="status">正在加载画布…</div>}>
      <StudioInner />
    </Suspense>
  );
}
