'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

type Finding = {
  id: string;
  ruleId: string;
  status: string;
  severity: string;
  nonWaivable: boolean;
  message: string;
  evidence: { regions?: Array<{ x: number; y: number; width: number; height: number }> };
};

type Report = {
  id: string;
  assetVersionId: string;
  slot: string | null;
  status: string;
  overallStatus: string | null;
  findings: Finding[];
  disclaimer?: string;
};

type Approval = {
  id: string;
  qaReportId: string;
  assetVersionId: string;
  decision: string;
  actorRole: string;
  reason: string | null;
  decidedAt: string;
};

function ReviewInner() {
  const params = useParams<{ projectId: string }>();
  const search = useSearchParams();
  const workspaceId = search.get('workspaceId');
  const projectId = params.projectId;
  const [reports, setReports] = useState<Report[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [left, setLeft] = useState<string>('');
  const [right, setRight] = useState<string>('');
  const [msg, setMsg] = useState('');
  const [reason, setReason] = useState('');
  const [bundleId, setBundleId] = useState<string>('');

  const refresh = useCallback(async () => {
    if (!workspaceId || !projectId) return;
    const res = await fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/qa-reports`);
    const json = await res.json();
    setReports(json.items ?? []);
    setApprovals(json.approvals ?? []);
    if (!left && json.items?.[0]?.id) setLeft(json.items[0].id);
    if (!right && json.items?.[1]?.id) setRight(json.items[1].id);
  }, [workspaceId, projectId, left, right]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const leftReport = useMemo(() => reports.find((r) => r.id === left) ?? reports[0], [reports, left]);
  const rightReport = useMemo(() => reports.find((r) => r.id === right), [reports, right]);

  async function decide(decision: string) {
    if (!workspaceId || !leftReport) return;
    const res = await fetch(
      `/api/workspaces/${workspaceId}/asset-versions/${leftReport.assetVersionId}/approvals`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ qaReportId: leftReport.id, decision, reason }),
      },
    );
    const json = await res.json();
    if (!res.ok) {
      setMsg(json?.error?.message ?? 'decision failed');
      return;
    }
    setMsg(`${decision} recorded`);
    await refresh();
  }

  async function exportLeft() {
    if (!workspaceId || !projectId || !leftReport) return;
    const res = await fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/exports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [{ assetVersionId: leftReport.assetVersionId, slot: leftReport.slot ?? 'MAIN', qaReportId: leftReport.id }],
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMsg(json?.error?.message ?? 'export blocked');
      return;
    }
    setBundleId(json.id);
    setMsg(`Export ${json.status} ${json.id.slice(0, 8)}… zip=${json.zipSha256?.slice(0, 12) ?? 'pending'}`);
  }

  async function download() {
    if (!workspaceId || !bundleId) return;
    const res = await fetch(`/api/workspaces/${workspaceId}/exports/${bundleId}/download-url`);
    const json = await res.json();
    if (!res.ok) {
      setMsg(json?.error?.message ?? 'download not ready');
      return;
    }
    window.open(json.url, '_blank');
  }

  function panel(report: Report | undefined, title: string) {
    if (!report) return <p style={{ opacity: 0.6 }}>No report</p>;
    const tone =
      report.overallStatus === 'BLOCK' ? '#c0392b' : report.overallStatus === 'REVIEW' ? '#d68910' : '#1e8449';
    return (
      <div>
        <h3>
          {title} · <span style={{ color: tone }}>{report.overallStatus ?? report.status}</span>
        </h3>
        <p style={{ fontSize: 12, opacity: 0.75 }}>
          version {report.assetVersionId.slice(0, 8)}… · slot {report.slot ?? '—'}
        </p>
        <div
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: '1',
            background: '#111',
            border: report.overallStatus === 'BLOCK' ? '3px solid #c0392b' : '1px solid #333',
            marginBottom: 12,
          }}
        >
          {(report.findings ?? []).flatMap((f) =>
            (f.evidence?.regions ?? []).map((r, i) => (
              <div
                key={`${f.id}-${i}`}
                title={`${f.ruleId} ${f.status}`}
                style={{
                  position: 'absolute',
                  left: `${r.x * 100}%`,
                  top: `${r.y * 100}%`,
                  width: `${r.width * 100}%`,
                  height: `${r.height * 100}%`,
                  border: `2px solid ${f.status === 'FAIL' ? '#e74c3c' : f.status === 'REVIEW' ? '#f1c40f' : '#2ecc71'}`,
                  boxSizing: 'border-box',
                }}
              />
            )),
          )}
        </div>
        <ul>
          {report.findings.map((f) => (
            <li key={f.id}>
              <code>{f.ruleId}</code> <strong>{f.status}</strong> {f.severity}
              {f.nonWaivable ? ' · nonWaivable' : ''} — {f.message}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (!workspaceId) return <p>Missing workspaceId</p>;

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <p>
        <a href={`/projects/${projectId}?workspaceId=${workspaceId}`}>← Project</a>
        {' · '}
        <a href={`/projects/${projectId}/studio?workspaceId=${workspaceId}`}>Studio</a>
      </p>
      <h1>Review — QA findings, compare, approve</h1>
      <p style={{ opacity: 0.75, maxWidth: 720 }}>
        {leftReport?.disclaimer ??
          'Automatic QA is a pre-publish assistant. qa_gate PASS is not human Approval. MAIN BLOCK blocks default export.'}
      </p>
      <p>
        <strong>{msg}</strong>
      </p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <label>
          Left{' '}
          <select value={left} onChange={(e) => setLeft(e.target.value)}>
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.slot} {r.overallStatus ?? r.status} {r.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Right{' '}
          <select value={right} onChange={(e) => setRight(e.target.value)}>
            <option value="">—</option>
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.slot} {r.overallStatus ?? r.status} {r.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {panel(leftReport, 'Selected')}
        {panel(rightReport, 'Compare')}
      </div>
      <section style={{ marginTop: 24 }}>
        <h2>Decision (append-only)</h2>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Override reason (required for OVERRIDE_BLOCK)"
          rows={3}
          style={{ width: '100%', maxWidth: 640 }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => void decide('APPROVE')}>
            Approve
          </button>
          <button type="button" onClick={() => void decide('REJECT')}>
            Reject
          </button>
          <button type="button" onClick={() => void decide('OVERRIDE_BLOCK')}>
            Override BLOCK
          </button>
          <button type="button" onClick={() => void decide('REVOKE')}>
            Revoke
          </button>
          <button type="button" onClick={() => void exportLeft()}>
            Export selected
          </button>
          <button type="button" onClick={() => void download()} disabled={!bundleId}>
            Download ZIP
          </button>
        </div>
        <h3>Approvals</h3>
        <ul>
          {approvals.map((a) => (
            <li key={a.id}>
              {a.decision} by {a.actorRole} · {a.decidedAt}
              {a.reason ? ` — ${a.reason}` : ''}
            </li>
          ))}
          {approvals.length === 0 && <li>None yet — QA PASS does not approve.</li>}
        </ul>
      </section>
    </div>
  );
}

export default function ReviewPage() {
  return (
    <Suspense fallback={<p>Loading review…</p>}>
      <ReviewInner />
    </Suspense>
  );
}
