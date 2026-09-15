'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, EmptyState, ErrorBanner, Input, Spinner } from '@/components/ui';
import { useWorkspace } from '@/lib/use-workspace';

type Project = { id: string; sku: string; name: string; status: string };

export default function ProjectsPage() {
  const { workspaceId, loading: wsLoading, projectHref } = useWorkspace();
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sku, setSku] = useState('MUG-BLK-450');
  const [name, setName] = useState('演示马克杯');

  useEffect(() => {
    if (wsLoading) return;
    if (!workspaceId) {
      setError('请先登录');
      return;
    }
    (async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/projects`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message ?? '加载项目失败');
        return;
      }
      const data = await res.json();
      setProjects(data.items ?? []);
    })().catch((e) => setError(String(e)));
  }, [workspaceId, wsLoading]);

  async function createProject() {
    if (!workspaceId) return;
    const res = await fetch(`/api/workspaces/${workspaceId}/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sku, name, marketplace: 'US', category: 'Kitchen > Drinkware' }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json?.error?.message ?? '创建失败');
      return;
    }
    setProjects((p) => [json, ...p]);
  }

  return (
    <div className="container">
      <h1>项目</h1>
      <p className="muted">W2 素材库 + Truth Pack（产品真相包）入口。</p>
      {error && <ErrorBanner message={error} />}
      {wsLoading && <Spinner label="正在解析工作空间…" />}
      <div className="row" style={{ marginBottom: 'var(--space-4)' }}>
        <Input
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          placeholder="SKU"
          style={{ width: 200 }}
        />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="名称"
          style={{ width: 240 }}
        />
        <Button variant="primary" onClick={createProject}>
          创建项目
        </Button>
      </div>
      {projects.length === 0 ? (
        <EmptyState>暂无项目 — 输入 SKU 与名称创建第一个项目。</EmptyState>
      ) : (
        <ul className="stack" style={{ gap: 'var(--space-2)', paddingLeft: 18 }}>
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={projectHref(`/projects/${p.id}`)}>
                {p.sku} — {p.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
