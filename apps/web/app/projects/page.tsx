'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, EmptyState, ErrorBanner, Input } from '@/components/ui';

type Workspace = { id: string; name: string; role: string };
type Project = { id: string; sku: string; name: string; status: string };

export default function ProjectsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sku, setSku] = useState('MUG-BLK-450');
  const [name, setName] = useState('演示马克杯');

  useEffect(() => {
    (async () => {
      const me = await fetch('/api/me');
      if (!me.ok) {
        setError('请先登录');
        return;
      }
      const json = await me.json();
      const ws: Workspace | undefined = json.workspaces?.[0];
      if (!ws) {
        setError('暂无工作空间');
        return;
      }
      setWorkspaceId(ws.id);
      const res = await fetch(`/api/workspaces/${ws.id}/projects`);
      const data = await res.json();
      setProjects(data.items ?? []);
    })().catch((e) => setError(String(e)));
  }, []);

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
              <Link href={`/projects/${p.id}?workspaceId=${workspaceId}`}>
                {p.sku} — {p.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
