'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

type Asset = {
  id: string;
  status: string;
  originalFilename: string | null;
  currentVersionId: string | null;
};

type Fact = {
  id: string;
  key: string;
  value: unknown;
  confidence: number;
  status: string;
};

type TruthPack = {
  documentId: string;
  currentRevisionId: string | null;
  approvedRevisionId: string | null;
  revision: {
    id: string;
    revision: number;
    status: string;
    facts: Fact[];
    constraints: Array<{ kind: string; path: string }>;
  } | null;
};

type ShotBrief = {
  id: string;
  slot: string;
  purpose: string;
  orderIndex: number;
  constraints: { aspectRatio: string; qaPolicy: string };
};

type ShotPlan = {
  documentId: string;
  currentRevisionId: string | null;
  approvedRevisionId: string | null;
  revision: {
    id: string;
    revision: number;
    status: string;
    truthRevisionId: string;
    briefs: ShotBrief[];
  } | null;
  canvasPayload: { briefs: Array<{ orderIndex: number; slot: string }> } | null;
};

function ProjectDetailInner() {
  const params = useParams<{ projectId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const workspaceId = search.get('workspaceId');
  const projectId = params.projectId;
  const [assets, setAssets] = useState<Asset[]>([]);
  const [pack, setPack] = useState<TruthPack | null>(null);
  const [shotPlan, setShotPlan] = useState<ShotPlan | null>(null);
  const [msg, setMsg] = useState<string>('');
  const [uploading, setUploading] = useState(false);

  const ready = Boolean(workspaceId && projectId);

  const refresh = useCallback(async () => {
    if (!workspaceId || !projectId) return;
    const [aRes, tRes, sRes] = await Promise.all([
      fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/assets`),
      fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/truth-pack`),
      fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/shot-plans`),
    ]);
    const aJson = await aRes.json();
    const tJson = await tRes.json();
    const sJson = await sRes.json();
    setAssets(aJson.items ?? []);
    setPack(tJson);
    setShotPlan(sJson);
  }, [workspaceId, projectId]);

  useEffect(() => {
    if (ready) void refresh();
  }, [ready, refresh]);

  const versionIds = useMemo(
    () => assets.map((a) => a.currentVersionId).filter(Boolean) as string[],
    [assets],
  );

  async function onFile(file: File) {
    if (!workspaceId || !projectId) return;
    setUploading(true);
    setMsg('正在预签名…');
    try {
      const mimeType =
        file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/webp'
          ? file.type
          : 'image/png';
      const presign = await fetch(`/api/workspaces/${workspaceId}/uploads/presign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId,
          filename: file.name,
          mimeType,
          bytes: file.size,
        }),
      });
      const pJson = await presign.json();
      if (!presign.ok) throw new Error(pJson?.error?.message ?? '预签名失败');

      setMsg('正在上传到对象存储…');
      const put = await fetch(pJson.uploadUrl, {
        method: 'PUT',
        headers: pJson.headers ?? { 'Content-Type': mimeType },
        body: file,
      });
      if (!put.ok) throw new Error(`S3 PUT 失败：${put.status}`);

      setMsg('正在完成并检查…');
      const complete = await fetch(
        `/api/workspaces/${workspaceId}/uploads/${pJson.uploadId}/complete`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ completionKey: `ui-${pJson.uploadId}` }),
        },
      );
      const cJson = await complete.json();
      if (!complete.ok) throw new Error(cJson?.error?.message ?? '完成失败');

      for (let i = 0; i < 30; i++) {
        const res = await fetch(`/api/workspaces/${workspaceId}/assets/${pJson.assetId}`);
        const asset = await res.json();
        if (asset.status === 'READY' || asset.status === 'REJECTED') {
          setMsg(`素材 ${asset.status}`);
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function extract() {
    if (!workspaceId || !projectId || versionIds.length === 0) {
      setMsg('请先上传一份 READY 素材');
      return;
    }
    const res = await fetch(
      `/api/workspaces/${workspaceId}/projects/${projectId}/truth-pack/extract`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assetVersionIds: versionIds }),
      },
    );
    const json = await res.json();
    if (!res.ok) {
      setMsg(json?.error?.message ?? '抽取失败');
      return;
    }
    setPack(json.pack);
    setMsg(`已通过 ${json.provider} 抽取`);
  }

  async function confirmAll() {
    if (!workspaceId || !projectId || !pack?.revision) return;
    const updates = pack.revision.facts
      .filter((f) => f.status === 'EXTRACTED')
      .map((f) => ({ factId: f.id, status: 'CONFIRMED' as const }));
    if (updates.length === 0) {
      setMsg('没有可确认的条目');
      return;
    }
    const res = await fetch(
      `/api/workspaces/${workspaceId}/projects/${projectId}/truth-pack/confirm`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ updates }),
      },
    );
    const json = await res.json();
    if (!res.ok) {
      setMsg(json?.error?.message ?? '确认失败');
      return;
    }
    setPack(json);
    setMsg('事实已确认');
  }

  async function approve() {
    if (!workspaceId || !projectId || !pack?.revision) return;
    const res = await fetch(
      `/api/workspaces/${workspaceId}/projects/${projectId}/truth-pack/approve`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revisionId: pack.revision.id }),
      },
    );
    const json = await res.json();
    if (!res.ok) {
      setMsg(json?.error?.message ?? '审批失败');
      return;
    }
    setPack(json);
    setMsg('Truth Pack 已批准');
  }


  async function generateShotPlan() {
    if (!workspaceId || !projectId) return;
    if (!pack?.approvedRevisionId) {
      setMsg('请先批准 Truth Pack');
      return;
    }
    const res = await fetch(
      `/api/workspaces/${workspaceId}/projects/${projectId}/shot-plans/generate`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    const json = await res.json();
    if (!res.ok) {
      setMsg(json?.error?.message ?? 'Shot Plan 生成失败');
      return;
    }
    setShotPlan(json.plan);
    setMsg(`已通过 ${json.provider} 起草 Shot Plan（${json.plan?.revision?.briefs?.length ?? 0} 条简报）`);
  }

  async function approveShotPlan() {
    if (!workspaceId || !projectId || !shotPlan?.revision) return;
    const res = await fetch(
      `/api/workspaces/${workspaceId}/projects/${projectId}/shot-plans/approve`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revisionId: shotPlan.revision.id }),
      },
    );
    const json = await res.json();
    if (!res.ok) {
      setMsg(json?.error?.message ?? 'Shot Plan 审批失败');
      return;
    }
    setShotPlan(json);
    setMsg('Shot Plan 已批准');
  }

  async function materializeShotPlan() {
    if (!workspaceId || !projectId) return;
    if (!shotPlan?.approvedRevisionId) {
      setMsg('请先批准 Shot Plan');
      return;
    }
    const res = await fetch(
      `/api/workspaces/${workspaceId}/projects/${projectId}/shot-plans/materialize`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    const json = await res.json();
    if (!res.ok) {
      setMsg(json?.error?.message ?? '物化失败');
      return;
    }
    setMsg(`已物化 ${json.briefCount} 图工作流`);
    router.push(`/projects/${projectId}/studio?workspaceId=${workspaceId}`);
  }

  if (!workspaceId) {
    return <p>缺少 workspaceId 查询参数。请从 /projects 打开。</p>;
  }

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <div style={{ marginBottom: 12 }}>
        <a href={`/projects/${projectId}/wizard?workspaceId=${workspaceId}`} style={{ color: '#9db7ff' }}>
          意图向导（一句话 → 一套图）→
        </a>
        {' · '}
        <a href={`/projects/${projectId}/studio?workspaceId=${workspaceId}`} style={{ color: '#9db7ff' }}>
          打开 Studio 画布 →
        </a>
        {' · '}
        <a href={`/projects/${projectId}/review?workspaceId=${workspaceId}`} style={{ color: '#9db7ff' }}>
          审核 / QA / 导出 →
        </a>
      </div>
      <h1>项目素材 + Truth Pack（产品真相包） + Shot Plan（拍摄计划）</h1>
      <p style={{ opacity: 0.75 }}>
        上传 → 批准 Truth Pack → 生成 7 镜计划（Fake） → 批准 → 一键物化（W3-B2）。当前仅 Fake 模式。
      </p>
      <p>
        <strong>{msg}</strong>
      </p>

      <section style={{ marginBottom: 24 }}>
        <h2>上传</h2>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
        />
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>素材库</h2>
        <ul>
          {assets.map((a) => (
            <li key={a.id}>
              {a.originalFilename ?? a.id} — <code>{a.status}</code>
              {a.currentVersionId ? ` · 版本 ${a.currentVersionId.slice(0, 8)}…` : ''}
            </li>
          ))}
          {assets.length === 0 && <li>暂无素材</li>}
        </ul>
      </section>

      <section>
        <h2>Truth Pack（产品真相包）</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button type="button" onClick={extract}>
            抽取（Fake Vision）
          </button>
          <button type="button" onClick={confirmAll}>
            确认全部 EXTRACTED
          </button>
          <button type="button" onClick={approve}>
            批准此修订
          </button>
        </div>
        {pack?.revision ? (
          <div>
            <p>
              修订 #{pack.revision.revision} — <code>{pack.revision.status}</code>
              {pack.approvedRevisionId ? ' · 已批准' : ''}
            </p>
            <ul>
              {pack.revision.facts.map((f) => (
                <li key={f.id}>
                  <strong>{f.key}</strong>: {JSON.stringify(f.value)} <code>{f.status}</code> (
                  {Math.round(f.confidence * 100)}%)
                </li>
              ))}
            </ul>
            <h3>约束</h3>
            <ul>
              {pack.revision.constraints.map((c, i) => (
                <li key={`${c.kind}-${c.path}-${i}`}>
                  {c.kind}: {c.path}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p>尚无修订 — 请抽取或保存事实。</p>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Shot Plan（拍摄计划）（W3-A）</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button type="button" onClick={generateShotPlan} disabled={!pack?.approvedRevisionId}>
            生成 7 镜（Fake）
          </button>
          <button type="button" onClick={approveShotPlan} disabled={!shotPlan?.revision}>
            批准 Shot Plan
          </button>
          <button
            type="button"
            onClick={materializeShotPlan}
            disabled={!shotPlan?.approvedRevisionId}
          >
            物化 → Studio
          </button>
        </div>
        {shotPlan?.revision ? (
          <div>
            <p>
              修订 #{shotPlan.revision.revision} — <code>{shotPlan.revision.status}</code>
              {shotPlan.approvedRevisionId ? ' · 已批准' : ''}
              {' · 真相 '}
              <code>{shotPlan.revision.truthRevisionId.slice(0, 8)}…</code>
            </p>
            <ul>
              {shotPlan.revision.briefs.map((b) => (
                <li key={b.id}>
                  #{b.orderIndex} <strong>{b.slot}</strong>: {b.purpose}{' '}
                  <code>{b.constraints.aspectRatio}</code>
                </li>
              ))}
            </ul>
            {shotPlan.canvasPayload ? (
              <p style={{ opacity: 0.7 }}>
                canvasPayload 已就绪（{shotPlan.canvasPayload.briefs.length} 条有序简报） · 物化会校验 referencedAssetVersionIds
              </p>
            ) : null}
          </div>
        ) : (
          <p>尚无 Shot Plan — 请先批准 Truth Pack，再生成。</p>
        )}
      </section>

    </div>
  );
}

export default function ProjectDetailPage() {
  return (
    <Suspense fallback={<p>加载中…</p>}>
      <ProjectDetailInner />
    </Suspense>
  );
}
