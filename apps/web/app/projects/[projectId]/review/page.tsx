'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button, EmptyState, ErrorBanner, Select, Spinner } from '@/components/ui';
import { ProjectStepper } from '@/components/project-stepper';
import { useWorkspace } from '@/lib/use-workspace';
import { useAssetImage } from '@/lib/use-asset-image';

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

/** Real NORMALIZED_PNG underlay for the compare panel; falls back to the gray well. */
function CompareImage(props: { workspaceId: string; versionId: string }) {
  const { url, loading, error } = useAssetImage(
    props.workspaceId,
    props.versionId,
    'NORMALIZED_PNG',
  );
  const [broken, setBroken] = useState(false);
  if (url && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="compare-img"
        src={url}
        alt="候选图"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span
      className="faint"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 'var(--font-size-sm)',
      }}
    >
      {loading ? '图像加载中…' : `图像不可用（${error ?? '加载失败'}）— 显示灰底`}
    </span>
  );
}

function ReviewInner() {
  const params = useParams<{ projectId: string }>();
  const { workspaceId, loading: wsLoading, projectHref } = useWorkspace();
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
        <EmptyState>
          尚未选择 QA 报告。请从 Studio 运行 Fake QA，或等待 evaluate 任务 — 新项目出现空状态是正常的。
        </EmptyState>
      );
    const tone =
      report.overallStatus === 'BLOCK'
        ? 'var(--danger-strong)'
        : report.overallStatus === 'REVIEW'
          ? 'var(--warn-strong)'
          : 'var(--ok-strong)';
    return (
      <div>
        <h3>
          {title} · <span style={{ color: tone }}>{report.overallStatus ?? report.status}</span>
        </h3>
        <p className="muted" style={{ fontSize: 'var(--font-size-sm)' }}>
          版本 {report.assetVersionId.slice(0, 8)}… · 槽位 {report.slot ?? '—'}
        </p>
        <div
          className={
            report.overallStatus === 'BLOCK' ? 'compare-well compare-well-block' : 'compare-well'
          }
        >
          {workspaceId ? (
            <CompareImage workspaceId={workspaceId} versionId={report.assetVersionId} />
          ) : null}
          {(report.findings ?? []).flatMap((f) =>
            (f.evidence?.regions ?? []).map((r, i) => (
              <div
                key={`${f.id}-${i}`}
                title={`${f.ruleId} ${f.status}`}
                className={`evidence-box ${
                  f.status === 'FAIL'
                    ? 'evidence-fail'
                    : f.status === 'REVIEW'
                      ? 'evidence-review'
                      : 'evidence-pass'
                }`}
                style={{
                  left: `${r.x * 100}%`,
                  top: `${r.y * 100}%`,
                  width: `${r.width * 100}%`,
                  height: `${r.height * 100}%`,
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
      <main className="container" role="main">
        <h1>审核</h1>
        {wsLoading ? (
          <Spinner label="正在解析工作空间…" />
        ) : (
          <p role="alert" className="banner-warn">
            无法解析工作空间 — 请先从 <Link href="/projects">项目列表</Link> 打开项目。
          </p>
        )}
      </main>
    );

  return (
    <main className="container container-wide" role="main" aria-labelledby="review-title">
      <ProjectStepper projectId={projectId} input={{ hasQaReports: reports.length > 0 }} />
      <p className="row">
        <Link href={projectHref(`/projects/${projectId}`)}>← 项目</Link>
        <Link href={projectHref(`/projects/${projectId}/studio`)}>Studio</Link>
      </p>
      <h1 id="review-title">审核 — QA 发现、对比、批准</h1>
      <p className="muted" style={{ maxWidth: 720 }}>
        {leftReport?.disclaimer ??
          '自动 QA 是发布前助手。qa_gate PASS 不等于人工批准。MAIN BLOCK 会阻止默认导出。'}
      </p>
      <p aria-live="polite" role="status">
        <strong>{msg}</strong>
      </p>
      {loading && <Spinner label="正在加载 QA 报告…" />}
      {loadError && <ErrorBanner message={loadError} onRetry={() => void refresh()} />}
      {!loading && !loadError && reports.length === 0 && (
        <EmptyState>
          此项目尚无 QA 报告。请先在 Studio 生成候选图（Fake），再回到这里查看发现。
        </EmptyState>
      )}
      <div className="row" style={{ marginBottom: 'var(--space-4)' }}>
        <label className="row">
          左侧{' '}
          <Select
            aria-label="左侧 QA 报告"
            value={left}
            onChange={(e) => setLeft(e.target.value)}
            style={{ width: 'auto' }}
          >
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.slot} {r.overallStatus ?? r.status} {r.id.slice(0, 8)}
              </option>
            ))}
          </Select>
        </label>
        <label className="row">
          右侧{' '}
          <Select
            aria-label="右侧对比 QA 报告"
            value={right}
            onChange={(e) => setRight(e.target.value)}
            style={{ width: 'auto' }}
          >
            <option value="">—</option>
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.slot} {r.overallStatus ?? r.status} {r.id.slice(0, 8)}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-6)' }}>
        {panel(leftReport, '已选')}
        {panel(rightReport, '对比')}
      </div>
      <section style={{ marginTop: 'var(--space-6)' }}>
        <h2>决策（只追加）</h2>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="覆盖原因（OVERRIDE_BLOCK 必填）"
          aria-label="决策原因"
          rows={3}
          className="input"
          style={{ maxWidth: 640 }}
        />
        <div className="row" style={{ marginTop: 'var(--space-2)' }}>
          <Button aria-label="通过所选报告" onClick={() => void decide('APPROVE')}>
            通过
          </Button>
          <Button variant="danger" onClick={() => void decide('REJECT')}>驳回</Button>
          <Button variant="danger" onClick={() => void decide('OVERRIDE_BLOCK')}>覆盖 BLOCK</Button>
          <Button onClick={() => void decide('REVOKE')}>撤销</Button>
          <Button variant="primary" onClick={() => void exportLeft()}>
            导出所选
          </Button>
          <Button onClick={() => void download()} disabled={!bundleId}>
            下载 ZIP
          </Button>
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
    <Suspense fallback={<p role="status" className="container">正在加载审核…</p>}>
      <ReviewInner />
    </Suspense>
  );
}
