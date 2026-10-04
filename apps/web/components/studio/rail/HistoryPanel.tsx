'use client';

/**
 * 生成历史面板（左栏「🕘」飞出）：原任务抽屉内容 —— run 列表 + SSE 实时状态 +
 * 取消/重试；成功 run 的结果图按修订拉取，可拖回画布建成图片卡。
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { zh, RUN_STATUS_ZH } from '@/lib/zh-labels';
import { AssetImage } from '../../asset-image';

export type RunAllOutcome = { message: string; authRequired: boolean };

type RunItem = {
  id: string;
  nodeId: string;
  status: string;
  attempts: Array<{
    id: string;
    attemptNo: number;
    status: string;
    progress: number;
    errorClass?: string | null;
    errorMessage?: string | null;
  }>;
};

type RunRow = {
  id: string;
  status: string;
  estimateMicrounits: number;
  workflowRevisionId: string | null;
  items: RunItem[];
};

/** 单个成功 run 的结果缩略图：拖到画布建成绑定该版本的图片卡。 */
function RunResultThumbs(props: { workspaceId: string; workflowId: string; revisionId: string }) {
  const { workspaceId, workflowId, revisionId } = props;
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    void fetch(
      `/api/workspaces/${workspaceId}/workflows/${workflowId}/node-results?revisionId=${revisionId}`,
      { credentials: 'include' },
    )
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json().catch(() => null)) as {
          results?: Record<string, string[]>;
        } | null;
        if (!alive || !json?.results) return;
        setIds(Object.values(json.results).flat());
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [workspaceId, workflowId, revisionId]);
  if (ids.length === 0) return null;
  return (
    <div className="studio-history-thumbs">
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          className="studio-history-thumb"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/studio-asset', id);
            e.dataTransfer.effectAllowed = 'copy';
          }}
          title="拖到画布建成图片卡"
        >
          <AssetImage workspaceId={workspaceId} versionId={id} size={48} alt="生成结果" />
        </button>
      ))}
    </div>
  );
}

export function HistoryPanel(props: {
  workspaceId: string;
  projectId: string;
  workflowId: string | null;
  msg: RunAllOutcome | null;
  /** 有 run 处于 QUEUED/RUNNING 时置 true（驱动节点结果轮询）。 */
  onActiveChange?: (active: boolean) => void;
}) {
  const { workspaceId, projectId, workflowId, msg, onActiveChange } = props;
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [events, setEvents] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/runs`, {
      credentials: 'include',
    });
    if (res.ok) {
      const data = await res.json();
      setRuns(data.runs ?? []);
    }
  }, [workspaceId, projectId]);

  useEffect(() => {
    void refresh();
    const es = new EventSource(`/api/workspaces/${workspaceId}/events?projectId=${projectId}`);
    const push = (type: string, ev: MessageEvent) => {
      setEvents((prev) => [`${type}: ${ev.data}`.slice(0, 180), ...prev].slice(0, 8));
      void refresh();
    };
    es.addEventListener('attempt.running', (e) => push('运行中', e as MessageEvent));
    es.addEventListener('attempt.progress', (e) => push('进度', e as MessageEvent));
    es.addEventListener('attempt.succeeded', (e) => push('成功', e as MessageEvent));
    es.addEventListener('attempt.failed', (e) => push('失败', e as MessageEvent));
    es.onerror = () => {
      /* browser auto-reconnects */
    };
    const t = setInterval(() => void refresh(), 3000);
    return () => {
      es.close();
      clearInterval(t);
    };
  }, [workspaceId, projectId, refresh]);

  const anyActive = runs.some((r) => r.status === 'RUNNING' || r.status === 'QUEUED');
  useEffect(() => {
    onActiveChange?.(anyActive);
  }, [anyActive, onActiveChange]);

  async function cancelRun(runId: string) {
    await fetch(`/api/workspaces/${workspaceId}/runs/${runId}/cancel`, {
      method: 'POST',
      credentials: 'include',
    });
    await refresh();
  }

  async function retryAttempt(attemptId: string) {
    await fetch(`/api/workspaces/${workspaceId}/attempts/${attemptId}/retry`, {
      method: 'POST',
      credentials: 'include',
    });
    await refresh();
  }

  return (
    <div className="studio-history">
      <div className="row">
        <strong>生成历史</strong>
        <button type="button" className="btn" onClick={() => void refresh()}>
          刷新
        </button>
      </div>
      {msg && (
        <div style={{ opacity: 0.85, fontSize: 'var(--font-size-sm)' }}>
          {msg.authRequired ? (
            <>
              生图需要登录账号 — <Link href="/login">去登录</Link>
            </>
          ) : (
            msg.message
          )}
        </div>
      )}
      {runs.length === 0 && (
        <div role="status" className="faint">
          暂无运行 — 排队 / 运行中 / 成功 / 失败会显示在这里。
        </div>
      )}
      {runs.map((r) => (
        <div key={r.id} className="run-card">
          <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'space-between' }}>
            <span>
              <code>{r.id.slice(0, 8)}</code> · <strong>{zh(RUN_STATUS_ZH, r.status)}</strong> · 预估{' '}
              {(r.estimateMicrounits / 1_000_000).toFixed(3)} 美元
            </span>
            {(r.status === 'QUEUED' || r.status === 'RUNNING') && (
              <button type="button" className="btn" onClick={() => void cancelRun(r.id)}>
                取消
              </button>
            )}
          </div>
          {r.items.map((it) => {
            const latest = it.attempts[it.attempts.length - 1];
            return (
              <div
                key={it.id}
                style={{ fontSize: 'var(--font-size-sm)', opacity: 0.9, paddingLeft: 8 }}
              >
                节点 <code>{it.nodeId}</code> · {zh(RUN_STATUS_ZH, it.status)}
                {latest && (
                  <>
                    {' '}
                    · 尝试 #{latest.attemptNo} {zh(RUN_STATUS_ZH, latest.status)}（{latest.progress}
                    %）
                    {latest.errorClass && (
                      <span style={{ color: 'var(--danger-text)' }}>
                        {' '}
                        {latest.errorClass}: {latest.errorMessage}
                      </span>
                    )}
                    {(latest.status === 'FAILED_FINAL' ||
                      latest.status === 'FAILED_RETRYABLE') && (
                      <button
                        type="button"
                        className="btn"
                        style={{ marginLeft: 8 }}
                        onClick={() => void retryAttempt(latest.id)}
                      >
                        重试
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
          {r.status === 'SUCCEEDED' && r.workflowRevisionId && workflowId ? (
            <RunResultThumbs
              workspaceId={workspaceId}
              workflowId={workflowId}
              revisionId={r.workflowRevisionId}
            />
          ) : null}
        </div>
      ))}
      {events.length > 0 && (
        <div className="faint" style={{ fontSize: 'var(--font-size-xs)' }}>
          实时事件：{events[0]}
        </div>
      )}
    </div>
  );
}
