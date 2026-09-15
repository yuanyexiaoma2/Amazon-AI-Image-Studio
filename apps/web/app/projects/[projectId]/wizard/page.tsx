'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui';

type Brief = {
  id: string;
  slot: string;
  purpose: string;
  orderIndex: number;
  copy: Array<{ text: string; source: string }>;
  must: string[];
  mustNot: string[];
  constraints: { aspectRatio: string; qaPolicy: string };
};

type Plan = {
  currentRevisionId: string | null;
  approvedRevisionId: string | null;
  revision: { id: string; revision: number; status: string; briefs: Brief[] } | null;
};

type Workspace = { id: string; name: string; role: string; autoApproveGates?: boolean };

const INTENT_PLACEHOLDER = `用几句话说清这套图要什么，例如：
主打 450ml 大容量和 18 小时保温；
场景：办公桌、车载、户外露营；
风格：干净明亮、北欧风；
目标客户：通勤白领`;

function WizardInner() {
  const params = useParams<{ projectId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const workspaceId = search.get('workspaceId');
  const projectId = params.projectId;

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [intent, setIntent] = useState('');
  const [includePackage, setIncludePackage] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [autoApproved, setAutoApproved] = useState(false);
  const [provider, setProvider] = useState('');
  const [busy, setBusy] = useState<'generate' | 'approve' | 'materialize' | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    (async () => {
      const me = await fetch('/api/me');
      if (!me.ok) return;
      const json = await me.json();
      const ws = (json.workspaces ?? []).find((w: Workspace) => w.id === workspaceId);
      if (ws) setWorkspace(ws);
    })().catch(() => undefined);
  }, [workspaceId]);

  const approved = Boolean(plan?.approvedRevisionId) || autoApproved;
  const isAdmin = workspace?.role === 'OWNER' || workspace?.role === 'ADMIN';

  const generate = useCallback(async () => {
    if (!workspaceId || !projectId) return;
    setBusy('generate');
    setMsg('AI 正在理解意图并规划卖点与场景…');
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/projects/${projectId}/shot-plans/generate`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            intent: intent.trim() || undefined,
            includePackage,
            autoApprove: true,
          }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? '生成失败');
      setPlan(json.plan);
      setAutoApproved(Boolean(json.autoApproved));
      setProvider(json.provider);
      setMsg(
        json.autoApproved
          ? '计划已生成并自动批准（工作区已开启自动门禁），可直接物化到画布。'
          : '计划已生成。请检查每条简报，确认后批准。',
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [workspaceId, projectId, intent, includePackage]);

  const approve = useCallback(async () => {
    if (!workspaceId || !projectId || !plan?.revision) return;
    setBusy('approve');
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/projects/${projectId}/shot-plans/approve`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ revisionId: plan.revision.id }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? '批准失败');
      setPlan(json);
      setMsg('已批准。可以物化到画布。');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [workspaceId, projectId, plan]);

  const materialize = useCallback(async () => {
    if (!workspaceId || !projectId) return;
    setBusy('materialize');
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/projects/${projectId}/shot-plans/materialize`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? '物化失败');
      router.push(`/projects/${projectId}/studio?workspaceId=${workspaceId}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }, [workspaceId, projectId, router]);

  const toggleGates = useCallback(async () => {
    if (!workspace) return;
    const next = !workspace.autoApproveGates;
    const res = await fetch(`/api/workspaces/${workspace.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ autoApproveGates: next }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMsg(json?.error?.message ?? '开关更新失败');
      return;
    }
    setWorkspace({ ...workspace, autoApproveGates: json.autoApproveGates });
  }, [workspace]);

  if (!workspaceId) {
    return <p className="container">缺少 workspaceId 查询参数。请从项目页打开向导。</p>;
  }

  return (
    <div className="container" style={{ maxWidth: 880 }}>
      <p>
        <a href={`/projects/${projectId}?workspaceId=${workspaceId}`}>← 返回项目</a>
      </p>
      <h1>意图向导：一句话 → 一套图的计划</h1>
      <p className="muted">
        第 1 步填意图 → 第 2 步 AI 规划卖点与场景 → 第 3 步批准并物化到画布。前提：Truth Pack 已批准。
      </p>

      {isAdmin && workspace && (
        <p className="muted" style={{ fontSize: 'var(--font-size-sm)' }}>
          <label style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={Boolean(workspace.autoApproveGates)}
              onChange={() => void toggleGates()}
            />{' '}
            个人模式：生成后自动批准门禁（全程留审计）
          </label>
        </p>
      )}

      <section style={{ marginBottom: 'var(--space-5)' }}>
        <h2>第 1 步 · 你的意图</h2>
        <textarea
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          placeholder={INTENT_PLACEHOLDER}
          rows={7}
          className="input"
        />
        <p style={{ fontSize: 'var(--font-size-sm)', marginTop: 'var(--space-2)' }}>
          <label>
            <input
              type="checkbox"
              checked={includePackage}
              onChange={(e) => setIncludePackage(e.target.checked)}
            />{' '}
            包含包装图（PACKAGE 槽位）
          </label>
        </p>
        <Button
          variant="primary"
          size="lg"
          onClick={() => void generate()}
          disabled={busy !== null}
        >
          {busy === 'generate' ? 'AI 规划中…' : '第 2 步 · AI 生成拍摄计划'}
        </Button>
      </section>

      <p aria-live="polite">
        <strong>{msg}</strong>
      </p>

      {plan?.revision && (
        <section>
          <h2>
            第 3 步 · 检查计划（修订 #{plan.revision.revision}
            {provider ? ` · ${provider}` : ''}
            {approved ? ' · 已批准' : ''}）
          </h2>
          <ol className="stack" style={{ paddingLeft: 0, gap: 'var(--space-3)' }}>
            {plan.revision.briefs.map((b) => (
              <li key={b.id} className="card" style={{ listStyle: 'none' }}>
                <div>
                  <strong>
                    #{b.orderIndex} {b.slot}
                  </strong>{' '}
                  <code>{b.constraints.aspectRatio}</code> — {b.purpose}
                </div>
                {b.copy.length > 0 && (
                  <div style={{ fontSize: 'var(--font-size-sm)', marginTop: 6 }}>
                    文案：
                    {b.copy.map((c, i) => (
                      <span key={i} style={{ marginRight: 8 }}>
                        「{c.text}」
                      </span>
                    ))}
                  </div>
                )}
                <div className="muted" style={{ fontSize: 'var(--font-size-xs)', marginTop: 6 }}>
                  必须：{b.must.join('；')}
                  <br />
                  禁止：{b.mustNot.join('；')}
                </div>
              </li>
            ))}
          </ol>
          <div className="row">
            {!approved && (
              <Button onClick={() => void approve()} disabled={busy !== null} size="lg">
                {busy === 'approve' ? '批准中…' : '批准计划'}
              </Button>
            )}
            <Button
              variant="primary"
              size="lg"
              onClick={() => void materialize()}
              disabled={!approved || busy !== null}
            >
              {busy === 'materialize' ? '物化中…' : '物化到画布 →'}
            </Button>
            {!approved && (
              <Button onClick={() => void generate()} disabled={busy !== null}>
                不满意，重新生成
              </Button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

export default function WizardPage() {
  return (
    <Suspense fallback={<p className="container">加载中…</p>}>
      <WizardInner />
    </Suspense>
  );
}
