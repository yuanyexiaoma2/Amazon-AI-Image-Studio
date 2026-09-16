'use client';

/**
 * PR-6 — lightweight project switcher for the workbench top bar: pick a
 * project without leaving the canvas, or create one inline (SKU + name).
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Select } from '@/components/ui';

type ProjectItem = { id: string; sku: string; name: string };

export function ProjectSwitcher(props: { workspaceId: string; projectId: string }) {
  const { workspaceId, projectId } = props;
  const router = useRouter();
  const [items, setItems] = useState<ProjectItem[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/projects`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { items: ProjectItem[] };
      setItems(data.items);
    } catch {
      setItems([]);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSelect = (value: string) => {
    if (value === '__new__') {
      setCreating(true);
      return;
    }
    if (value && value !== projectId) {
      router.push(`/projects/${value}/studio`);
    }
  };

  const create = async () => {
    if (!sku.trim() || !name.trim()) {
      setError('SKU 和名称必填');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sku: sku.trim(), name: name.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created = (await res.json()) as { id: string };
      router.push(`/projects/${created.id}/studio`);
    } catch {
      setError('创建失败，请重试');
      setBusy(false);
    }
  };

  return (
    <div className="project-switcher">
      <Select
        value={creating ? '__new__' : projectId}
        onChange={(e) => onSelect(e.target.value)}
        aria-label="切换项目"
      >
        {(items ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.sku} · {p.name}
          </option>
        ))}
        {!items?.some((p) => p.id === projectId) ? (
          <option value={projectId}>当前项目</option>
        ) : null}
        <option value="__new__">＋ 新建项目…</option>
      </Select>
      {creating ? (
        <span className="project-switcher-create">
          <Input
            placeholder="SKU"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            aria-label="新项目 SKU"
          />
          <Input
            placeholder="项目名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="新项目名称"
          />
          <Button variant="primary" disabled={busy} onClick={() => void create()}>
            {busy ? '创建中…' : '创建'}
          </Button>
          <Button
            onClick={() => {
              setCreating(false);
              setError(null);
            }}
          >
            取消
          </Button>
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="project-switcher-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}
