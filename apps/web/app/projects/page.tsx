'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

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
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <h1>项目</h1>
      <p style={{ opacity: 0.75 }}>W2 素材库 + Truth Pack（产品真相包）入口。</p>
      {error && <p style={{ color: '#f88' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="名称" />
        <button type="button" onClick={createProject}>
          创建项目
        </button>
      </div>
      <ul>
        {projects.map((p) => (
          <li key={p.id}>
            <Link href={`/projects/${p.id}?workspaceId=${workspaceId}`} style={{ color: '#9db7ff' }}>
              {p.sku} — {p.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
