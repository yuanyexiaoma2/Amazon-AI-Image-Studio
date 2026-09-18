'use client';

/**
 * V2 PR-4 — chat agent panel (the third canvas operator).
 *
 * Session lifecycle: on workflowId change, reuse the newest session bound to
 * this workflow or create one (default title 画布助手, budget $5). Sending a
 * message is one synchronous agent turn (POST messages); the reply may carry
 * an applied command batch (batchId) and/or a run. After any canvas mutation
 * the latest draft graph is re-fetched and handed to onGraphChanged so the
 * canvas state and its optimistic-concurrency revision stay in sync with the
 * server. A turn's batch can be rolled back through the existing
 * commands/undo endpoint.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { ChatMessage, ChatSession } from '@studio/contracts';
import { microunitsToAmount, type WorkflowGraph } from '@studio/domain';
import { zh, COMMAND_TYPE_ZH, RUN_STATUS_ZH } from '@/lib/zh-labels';
import { useMe } from '@/lib/use-me';
import { Badge, Button, EmptyState, ErrorBanner, Spinner, type BadgeTone } from '../ui';

const DEFAULT_SESSION_TITLE = '画布助手';
const DEFAULT_BUDGET_LIMIT = { currency: 'USD', amount: 5 };

function cardIcon(kind: 'flow' | 'run' | 'bg') {
  const paths = {
    flow: (
      <>
        <circle cx="5.5" cy="6" r="2.2" />
        <circle cx="18.5" cy="6" r="2.2" />
        <circle cx="12" cy="18" r="2.2" />
        <path d="M7.7 6h8.6M6.3 8l4.2 7.8M17.7 8l-4.2 7.8" />
      </>
    ),
    run: <path d="M8 5.5v13l10-6.5z" />,
    bg: (
      <>
        <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
        <circle cx="9" cy="10" r="1.6" />
        <path d="M4.5 17.5 10 12l3.5 3.5L17 12l3.5 3.5" />
      </>
    ),
  } as const;
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {paths[kind]}
    </svg>
  );
}

const SUGGESTIONS: Array<{ icon: 'flow' | 'run' | 'bg'; title: string; desc: string; prompt: string }> = [
  {
    icon: 'flow',
    title: '搭建生图流程',
    desc: '文本卡写提示词，连线到生图卡',
    prompt: '帮我搭建一个生图流程：新建一张文本卡写好提示词，再建一张生图卡并连线',
  },
  {
    icon: 'bg',
    title: '搭建换背景流程',
    desc: '图片卡作参考，生图卡换背景',
    prompt: '帮我搭建一个换背景流程：新建图片卡和生图卡并连线，生图卡提示词写换背景',
  },
  {
    icon: 'run',
    title: '运行整张画布',
    desc: '按当前连线从头跑一遍',
    prompt: '运行整图',
  },
];

/** content_json is a passthrough object — these extras ride alongside text. */
type AssistantExtra = {
  budgetRejected?: unknown;
  error?: unknown;
};

function runTone(status: string): BadgeTone {
  if (status === 'SUCCEEDED') return 'ok';
  if (status.startsWith('FAILED') || status === 'CANCELLED') return 'danger';
  if (status === 'RUNNING' || status === 'QUEUED') return 'accent';
  return 'default';
}

/** 命令类型列表 → 中文摘要，如「添加节点×2、连线」。 */
function summarizeTypes(types: string[]): string {
  const counts = new Map<string, number>();
  for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .map(([t, n]) => (n > 1 ? `${zh(COMMAND_TYPE_ZH, t)}×${n}` : zh(COMMAND_TYPE_ZH, t)))
    .join('、');
}

export function ChatPanel(props: {
  workspaceId: string;
  projectId: string;
  workflowId: string | null;
  /** Live optimistic-concurrency revision of the canvas draft (revisionRef). */
  getRevision: () => number;
  onGraphChanged: (graph: WorkflowGraph, revisionNumber: number) => void;
}) {
  const { workspaceId, projectId, workflowId } = props;
  const getRevisionRef = useRef(props.getRevision);
  getRevisionRef.current = props.getRevision;
  const onGraphChangedRef = useRef(props.onGraphChanged);
  onGraphChangedRef.current = props.onGraphChanged;

  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [runByMessage, setRunByMessage] = useState<Record<string, { status: string }>>({});
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [undoBusyId, setUndoBusyId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const msgsRef = useRef<HTMLDivElement | null>(null);
  const { me } = useMe();
  const userName = me?.email?.split('@')[0] ?? null;

  const base = `/api/workspaces/${workspaceId}/projects/${projectId}/chat-sessions`;

  const initSession = useCallback(async () => {
    if (!workflowId) return;
    setLoading(true);
    setError(null);
    setAuthRequired(false);
    setHint(null);
    setSession(null);
    setMessages([]);
    setRunByMessage({});
    try {
      const listRes = await fetch(`${base}?workflowId=${workflowId}`);
      const listJson = await listRes.json().catch(() => null);
      if (!listRes.ok) {
        setError(`会话列表加载失败：${listJson?.error?.message ?? listRes.status}`);
        return;
      }
      let sessionId: string | undefined = listJson?.items?.[0]?.id;
      if (!sessionId) {
        const createRes = await fetch(base, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            workflowId,
            title: DEFAULT_SESSION_TITLE,
            budgetLimit: DEFAULT_BUDGET_LIMIT,
          }),
        });
        const created = await createRes.json().catch(() => null);
        if (!createRes.ok) {
          setError(`会话创建失败：${created?.error?.message ?? createRes.status}`);
          return;
        }
        sessionId = created.id as string;
      }
      const detailRes = await fetch(`${base}/${sessionId}`);
      const detail = await detailRes.json().catch(() => null);
      if (!detailRes.ok) {
        setError(`会话加载失败：${detail?.error?.message ?? detailRes.status}`);
        return;
      }
      const { messages: msgs, ...sessionRow } = detail as ChatSession & {
        messages: ChatMessage[];
      };
      setSession(sessionRow);
      setMessages(msgs ?? []);
    } catch {
      setError('网络错误 — 会话未加载');
    } finally {
      setLoading(false);
    }
  }, [base, workflowId]);

  useEffect(() => {
    void initSession();
  }, [initSession]);

  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const pullGraph = useCallback(async () => {
    if (!workflowId) return;
    const res = await fetch(`/api/workspaces/${workspaceId}/workflows/${workflowId}`);
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setError(`画布刷新失败：${json?.error?.message ?? res.status}`);
      return;
    }
    onGraphChangedRef.current(json.graph as WorkflowGraph, json.revisionNumber as number);
  }, [workspaceId, workflowId]);

  const send = useCallback(
    async (rawContent?: string) => {
      const content = (rawContent ?? input).trim();
      if (!content || !session || sending) return;
    setSending(true);
    setError(null);
    setAuthRequired(false);
    setHint(null);
    try {
      const res = await fetch(`${base}/${session.id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const code = json?.error?.code as string | undefined;
        if (res.status === 401) {
          // LOCAL_MODE: browsing needs no login; generation/chat turns do.
          setAuthRequired(true);
          setError('生图需要登录账号');
        } else {
          setAuthRequired(false);
          setError(
            code === 'CHAT_AUTH_FAILED'
              ? '画布助手认证失败 — 请检查助手模型的密钥配置。'
              : code === 'CHAT_UNAVAILABLE'
                ? '画布助手暂不可用 — 请稍后重试。'
                : `发送失败：${json?.error?.message ?? res.status}`,
          );
        }
        // The USER message is persisted even when the turn fails — resync.
        const detailRes = await fetch(`${base}/${session.id}`);
        const detail = await detailRes.json().catch(() => null);
        if (detailRes.ok && detail) {
          setMessages((detail as { messages?: ChatMessage[] }).messages ?? []);
        }
        return;
      }
      const userMessage = json.userMessage as ChatMessage;
      const assistantMessage = json.assistantMessage as ChatMessage;
      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      const run = json.run as { status?: string; estimateMicrounits?: number } | undefined;
      if (run?.status) {
        setRunByMessage((prev) => ({
          ...prev,
          [assistantMessage.id]: { status: String(run.status) },
        }));
      }
      setInput('');
      if (json.batchId || run) {
        await pullGraph();
      }
      if (typeof run?.estimateMicrounits === 'number') {
        const spent = run.estimateMicrounits;
        setSession((prev) =>
          prev ? { ...prev, spentMicrounits: prev.spentMicrounits + spent } : prev,
        );
      }
    } catch {
      setError('网络错误 — 消息未发送');
    } finally {
      setSending(false);
    }
  }, [base, input, pullGraph, sending, session]);

  const undoTurn = useCallback(
    async (message: ChatMessage) => {
      if (!message.batchId || !workflowId || undoBusyId) return;
      setUndoBusyId(message.id);
      setError(null);
      setHint(null);
      try {
        const res = await fetch(
          `/api/workspaces/${workspaceId}/workflows/${workflowId}/commands/undo`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              ifRevision: getRevisionRef.current(),
              batchId: message.batchId,
            }),
          },
        );
        const json = await res.json().catch(() => null);
        if (res.ok) {
          onGraphChangedRef.current(json.graph as WorkflowGraph, json.revisionNumber as number);
          setHint('已撤销本轮画布操作');
          return;
        }
        const code = json?.error?.code as string | undefined;
        if (res.status === 409 && code === 'WORKFLOW_UNDO_CONFLICT') {
          setHint('该轮已撤销或当前状态不可撤销');
        } else if (res.status === 409) {
          setError('撤销冲突：画布已被其他操作更新，请重新加载后重试。');
        } else {
          setError(`撤销失败：${json?.error?.message ?? res.status}`);
        }
      } catch {
        setError('网络错误 — 撤销请求未发送');
      } finally {
        setUndoBusyId(null);
      }
    },
    [undoBusyId, workflowId, workspaceId],
  );

  if (!workflowId) {
    return <EmptyState>画布加载完成后即可与画布助手对话。</EmptyState>;
  }

  const budget = session?.budgetLimit ?? null;
  const remaining =
    budget && session ? budget.amount - microunitsToAmount(session.spentMicrounits) : null;

  return (
    <>
      <div className="chat-head">
        <strong>{session?.title ?? DEFAULT_SESSION_TITLE}</strong>
        {budget && remaining !== null ? (
          <Badge
            tone={remaining > 0 ? 'accent' : 'warn'}
          >
            <span title={`预算剩余 $${remaining.toFixed(2)} / $${budget.amount.toFixed(2)}`}>
              预算 ${remaining.toFixed(2)}
            </span>
          </Badge>
        ) : (
          <span className="faint" style={{ fontSize: 'var(--font-size-xs)' }}>
            未设预算 — 助手不会触发运行
          </span>
        )}
      </div>
      {error &&
        (authRequired ? (
          <p role="alert" className="banner-error">
            生图需要登录账号 — <Link href="/login">去登录</Link>
          </p>
        ) : (
          <ErrorBanner message={error} onRetry={session ? undefined : () => void initSession()} />
        ))}
      {hint && (
        <p role="status" className="banner-info">
          {hint}
        </p>
      )}
      {loading ? (
        <Spinner label="正在加载会话…" />
      ) : !session ? (
        !error && <EmptyState>暂无会话</EmptyState>
      ) : (
        <>
          <div className="chat-msgs" ref={msgsRef} aria-label="对话消息列表">
            {messages.length === 0 && !sending && (
              <div className="chat-empty">
                <div className="chat-greeting-hi">✦ Hi{userName ? `，${userName}` : ''}！</div>
                <div className="chat-greeting-title">今天一起创作点什么？</div>
                <div className="chat-suggest-list">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s.title}
                      type="button"
                      className="chat-suggest-card"
                      disabled={!session || sending}
                      onClick={() => void send(s.prompt)}
                    >
                      <span className="chat-suggest-icon">{cardIcon(s.icon)}</span>
                      <span className="chat-suggest-body">
                        <span className="chat-suggest-title">{s.title}</span>
                        <span className="chat-suggest-desc">{s.desc}</span>
                      </span>
                      <span className="chat-suggest-arrow" aria-hidden>
                        →
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => {
              if (m.role === 'SYSTEM') return null;
              const extra = m.content as AssistantExtra;
              const summary = m.content.commandsSummary;
              const runInfo = runByMessage[m.id];
              const errObj =
                extra.error && typeof extra.error === 'object'
                  ? (extra.error as { code?: string; message?: string })
                  : null;
              return (
                <div
                  key={m.id}
                  className={m.role === 'USER' ? 'chat-msg chat-msg-user' : 'chat-msg'}
                >
                  <div>{m.content.text}</div>
                  {m.role === 'ASSISTANT' && (
                    <div className="chat-msg-meta">
                      {summary && summary.count > 0 && (
                        <Badge tone="accent">
                          已应用 {summary.count} 条命令（{summarizeTypes(summary.types)}）
                        </Badge>
                      )}
                      {runInfo && (
                        <Badge tone={runTone(runInfo.status)}>运行{zh(RUN_STATUS_ZH, runInfo.status)}</Badge>
                      )}
                      {extra.budgetRejected === true && (
                        <Badge tone="warn">预算不足，未执行运行</Badge>
                      )}
                      {m.batchId && (
                        <Button
                          onClick={() => void undoTurn(m)}
                          disabled={undoBusyId !== null}
                          title="撤销这一轮对画布的修改"
                        >
                          {undoBusyId === m.id ? '撤销中…' : '撤销本轮'}
                        </Button>
                      )}
                    </div>
                  )}
                  {errObj && (
                    <div style={{ color: 'var(--danger-text)', marginTop: 4 }}>
                      命令执行失败：{errObj.code ?? '未知错误'} — {errObj.message ?? ''}
                    </div>
                  )}
                </div>
              );
            })}
            {sending && <Spinner label="助手思考中…" />}
          </div>
          <div className="chat-input-box">
            <textarea
              className="chat-input"
              value={input}
              placeholder="描述画布操作，Enter 发送 · Shift+Enter 换行"
              rows={2}
              disabled={sending}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="chat-input-bar">
              <button
                type="button"
                className="chat-send"
                onClick={() => void send()}
                disabled={sending || input.trim() === ''}
                aria-label="发送"
                title="发送"
              >
                {sending ? (
                  '…'
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
