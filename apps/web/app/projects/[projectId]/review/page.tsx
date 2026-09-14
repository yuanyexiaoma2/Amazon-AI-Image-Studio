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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const refresh = useCallback(async () => {
    if (!workspaceId || !projectId) return;
    setLoading(true);
    setLoadError('');
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/qa-reports`);
      const json = await res.json();
      if (!res.ok) {
        setLoadError(json?.error?.message ?? `加载报告失败（${res.status}）`);
        setReports([]);
        setApprovals([]);
        return;
      }
      setReports(json.items ?? []);
      setApprovals(json.approvals ?? []);
      if (!left && json.items?.[0]?.id) setLeft(json.items[0].id);
      if (!right && json.items?.[1]?.id) setRight(json.items[1].id);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '加载报告时网络错误');
    } finally {
      setLoading(false);
    }
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
      setMsg(json?.error?.message ?? '决策失败');
      return;
    }
    setMsg(`已记录 ${decision}`);
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
      setMsg(json?.error?.message ?? '导出被阻止');
      return;
    }
    setBundleId(json.id);
    setMsg(`导出 ${json.status} ${json.id.slice(0, 8)}… zip=${json.zipSha256?.slice(0, 12) ?? '处理中'}`);
  }

  async function download() {
    if (!workspaceId || !bundleId) return;
    const res = await fetch(`/api/workspaces/${workspaceId}/exports/${bundleId}/download-url`);
    const json = await res.json();
    if (!res.ok) {
      setMsg(json?.error?.message ?? '下载尚未就绪');
      return;
    }
    window.open(json.url, '_blank');
  }

  function panel(report: Report | undefined, title: string) {
    if (!report)
      return (
        <p role="status" style={{ opacity: 0.75, padding: 16, border: '1px dashed #666', borderRadius: 8 }}>
          尚未选择 QA 报告。请从 Studio 运行 Fake QA，或等待 evaluate 任务 — 新项目出现空状态是正常的。
        </p>
      );
    const tone =
      report.overallStatus === 'BLOCK' ? '#c0392b' : report.overallStatus === 'REVIEW' ? '#d68910' : '#1e8449';
    return (
      <div>
        <h3>
          {title} · <span style={{ color: tone }}>{report.overallStatus ?? report.status}</span>
        </h3>
        <p style={{ fontSize: 12, opacity: 0.75 }}>
          版本 {report.assetVersionId.slice(0, 8)}… · 槽位 {report.slot ?? '—'}
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
              {f.nonWaivable ? ' · 不可豁免' : ''} — {f.message}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (!workspaceId)
    return (
      <main style={{ padding: 24 }} role="main">
        <h1>审核</h1>
        <p role="alert">缺少 workspaceId 查询参数。请从项目页打开审核。</p>
      </main>
    );

  return (
    <main style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }} role="main" aria-labelledby="review-title">
      <p>
        <a href={`/projects/${projectId}?workspaceId=${workspaceId}`}>← 项目</a>
        {' · '}
        <a href={`/projects/${projectId}/studio?workspaceId=${workspaceId}`}>Studio</a>
      </p>
      <h1 id="review-title">审核 — QA 发现、对比、批准</h1>
      <p style={{ opacity: 0.75, maxWidth: 720 }}>
        {leftReport?.disclaimer ??
          '自动 QA 是发布前助手。qa_gate PASS 不等于人工批准。MAIN BLOCK 会阻止默认导出。'}
      </p>
      <p aria-live="polite" role="status">
        <strong>{msg}</strong>
      </p>
      {loading && (
        <p role="status" style={{ opacity: 0.8 }}>
          正在加载 QA 报告…
        </p>
      )}
      {loadError && (
        <p role="alert" style={{ color: '#c0392b', border: '1px solid #c0392b', padding: 12, borderRadius: 8 }}>
          {loadError}{' '}
          <button type="button" onClick={() => void refresh()}>
            重试
          </button>
        </p>
      )}
      {!loading && !loadError && reports.length === 0 && (
        <p role="status" style={{ opacity: 0.8, border: '1px dashed #888', padding: 16, borderRadius: 8 }}>
          此项目尚无 QA 报告。请先在 Studio 生成候选图（Fake），再回到这里查看发现。
        </p>
      )}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <label>
          左侧{' '}
          <select aria-label="左侧 QA 报告" value={left} onChange={(e) => setLeft(e.target.value)}>
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.slot} {r.overallStatus ?? r.status} {r.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        <label>
          右侧{' '}
          <select aria-label="右侧对比 QA 报告" value={right} onChange={(e) => setRight(e.target.value)}>
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
        {panel(leftReport, '已选')}
        {panel(rightReport, '对比')}
      </div>
      <section style={{ marginTop: 24 }}>
        <h2>决策（只追加）</h2>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="覆盖原因（OVERRIDE_BLOCK 必填）"
          aria-label="决策原因"
          rows={3}
          style={{ width: '100%', maxWidth: 640 }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button type="button" aria-label="通过所选报告" onClick={() => void decide('APPROVE')}>
            通过
          </button>
          <button type="button" onClick={() => void decide('REJECT')}>
            驳回
          </button>
          <button type="button" onClick={() => void decide('OVERRIDE_BLOCK')}>
            覆盖 BLOCK
          </button>
          <button type="button" onClick={() => void decide('REVOKE')}>
            撤销
          </button>
          <button type="button" onClick={() => void exportLeft()}>
            导出所选
          </button>
          <button type="button" onClick={() => void download()} disabled={!bundleId}>
            下载 ZIP
          </button>
        </div>
        <h3>审批记录</h3>
        <ul>
          {approvals.map((a) => (
            <li key={a.id}>
              {a.decision} · {a.actorRole} · {a.decidedAt}
              {a.reason ? ` — ${a.reason}` : ''}
            </li>
          ))}
          {approvals.length === 0 && <li>暂无 — QA PASS 并不等于批准。</li>}
        </ul>
      </section>
    </main>
  );
}

export default function ReviewPage() {
  return (
    <Suspense fallback={<p role="status">正在加载审核…</p>}>
      <ReviewInner />
    </Suspense>
  );
}
