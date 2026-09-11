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
  const [name, setName] = useState('Demo Mug');

  useEffect(() => {
    (async () => {
      const me = await fetch('/api/me');
      if (!me.ok) {
        setError('Please log in first');
        return;
      }
      const json = await me.json();
      const ws: Workspace | undefined = json.workspaces?.[0];
      if (!ws) {
        setError('No workspace');
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
      setError(json?.error?.message ?? 'Create failed');
      return;
    }
    setProjects((p) => [json, ...p]);
  }

  return (
    <div>
      <h1>Projects</h1>
      <p style={{ opacity: 0.75 }}>W2 asset library + Truth Pack entry.</p>
      {error && <p style={{ color: '#f88' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        <button type="button" onClick={createProject}>
          Create project
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
