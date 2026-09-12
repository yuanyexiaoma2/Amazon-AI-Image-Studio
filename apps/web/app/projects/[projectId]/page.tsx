'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

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
    setMsg('Presigning…');
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
      if (!presign.ok) throw new Error(pJson?.error?.message ?? 'presign failed');

      setMsg('Uploading to object storage…');
      const put = await fetch(pJson.uploadUrl, {
        method: 'PUT',
        headers: pJson.headers ?? { 'Content-Type': mimeType },
        body: file,
      });
      if (!put.ok) throw new Error(`S3 PUT failed: ${put.status}`);

      setMsg('Completing + inspect…');
      const complete = await fetch(
        `/api/workspaces/${workspaceId}/uploads/${pJson.uploadId}/complete`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ completionKey: `ui-${pJson.uploadId}` }),
        },
      );
      const cJson = await complete.json();
      if (!complete.ok) throw new Error(cJson?.error?.message ?? 'complete failed');

      for (let i = 0; i < 30; i++) {
        const res = await fetch(`/api/workspaces/${workspaceId}/assets/${pJson.assetId}`);
        const asset = await res.json();
        if (asset.status === 'READY' || asset.status === 'REJECTED') {
          setMsg(`Asset ${asset.status}`);
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
      setMsg('Upload a READY asset first');
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
      setMsg(json?.error?.message ?? 'extract failed');
      return;
    }
    setPack(json.pack);
    setMsg(`Extracted via ${json.provider}`);
  }

  async function confirmAll() {
    if (!workspaceId || !projectId || !pack?.revision) return;
    const updates = pack.revision.facts
      .filter((f) => f.status === 'EXTRACTED')
      .map((f) => ({ factId: f.id, status: 'CONFIRMED' as const }));
    if (updates.length === 0) {
      setMsg('Nothing to confirm');
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
      setMsg(json?.error?.message ?? 'confirm failed');
      return;
    }
    setPack(json);
    setMsg('Facts confirmed');
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
      setMsg(json?.error?.message ?? 'approve failed');
      return;
    }
    setPack(json);
    setMsg('Truth Pack APPROVED');
  }


  async function generateShotPlan() {
    if (!workspaceId || !projectId) return;
    if (!pack?.approvedRevisionId) {
      setMsg('Approve Truth Pack first');
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
      setMsg(json?.error?.message ?? 'shot plan generate failed');
      return;
    }
    setShotPlan(json.plan);
    setMsg(`Shot Plan drafted via ${json.provider} (${json.plan?.revision?.briefs?.length ?? 0} briefs)`);
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
      setMsg(json?.error?.message ?? 'shot plan approve failed');
      return;
    }
    setShotPlan(json);
    setMsg('Shot Plan APPROVED');
  }

  async function materializeShotPlan() {
    if (!workspaceId || !projectId) return;
    if (!shotPlan?.approvedRevisionId) {
      setMsg('Approve Shot Plan first');
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
      setMsg(json?.error?.message ?? 'materialize failed');
      return;
    }
    setMsg(
      `Materialized ${json.briefCount}-image workflow (${json.workflow?.graph?.nodes?.length ?? 0} nodes) → open Studio`,
    );
  }

  if (!workspaceId) {
    return <p>Missing workspaceId query param. Open from /projects.</p>;
  }

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <div style={{ marginBottom: 12 }}>
        <a href={`/projects/${projectId}/studio?workspaceId=${workspaceId}`} style={{ color: '#9db7ff' }}>
          Open Studio canvas →
        </a>
      </div>
      <h1>Project assets + Truth Pack + Shot Plan</h1>
      <p style={{ opacity: 0.75 }}>
        Upload → Truth Pack approve → generate 7-shot plan (Fake) → approve → one-click materialize (W3-B2). Fake only.
      </p>
      <p>
        <strong>{msg}</strong>
      </p>

      <section style={{ marginBottom: 24 }}>
        <h2>Upload</h2>
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
        <h2>Asset library</h2>
        <ul>
          {assets.map((a) => (
            <li key={a.id}>
              {a.originalFilename ?? a.id} — <code>{a.status}</code>
              {a.currentVersionId ? ` · version ${a.currentVersionId.slice(0, 8)}…` : ''}
            </li>
          ))}
          {assets.length === 0 && <li>No assets yet</li>}
        </ul>
      </section>

      <section>
        <h2>Truth Pack</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button type="button" onClick={extract}>
            Extract (Fake Vision)
          </button>
          <button type="button" onClick={confirmAll}>
            Confirm all EXTRACTED
          </button>
          <button type="button" onClick={approve}>
            Approve revision
          </button>
        </div>
        {pack?.revision ? (
          <div>
            <p>
              Revision #{pack.revision.revision} — <code>{pack.revision.status}</code>
              {pack.approvedRevisionId ? ' · approved' : ''}
            </p>
            <ul>
              {pack.revision.facts.map((f) => (
                <li key={f.id}>
                  <strong>{f.key}</strong>: {JSON.stringify(f.value)} <code>{f.status}</code> (
                  {Math.round(f.confidence * 100)}%)
                </li>
              ))}
            </ul>
            <h3>Constraints</h3>
            <ul>
              {pack.revision.constraints.map((c, i) => (
                <li key={`${c.kind}-${c.path}-${i}`}>
                  {c.kind}: {c.path}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p>No revision yet — extract or save facts.</p>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Shot Plan (W3-A)</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button type="button" onClick={generateShotPlan} disabled={!pack?.approvedRevisionId}>
            Generate 7-shot (Fake)
          </button>
          <button type="button" onClick={approveShotPlan} disabled={!shotPlan?.revision}>
            Approve Shot Plan
          </button>
          <button
            type="button"
            onClick={materializeShotPlan}
            disabled={!shotPlan?.approvedRevisionId}
          >
            Materialize → Studio
          </button>
        </div>
        {shotPlan?.revision ? (
          <div>
            <p>
              Revision #{shotPlan.revision.revision} — <code>{shotPlan.revision.status}</code>
              {shotPlan.approvedRevisionId ? ' · approved' : ''}
              {' · truth '}
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
                canvasPayload ready ({shotPlan.canvasPayload.briefs.length} ordered briefs) · materialize validates referencedAssetVersionIds
              </p>
            ) : null}
          </div>
        ) : (
          <p>No Shot Plan yet — approve Truth Pack, then generate.</p>
        )}
      </section>

    </div>
  );
}

export default function ProjectDetailPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <ProjectDetailInner />
    </Suspense>
  );
}
