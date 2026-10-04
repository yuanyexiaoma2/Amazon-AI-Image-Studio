'use client';

/**
 * 创意参谋面板（原 V2 PR-4 画布助手改造，2026-09-19 owner ruling）：
 * 只当提示词优化 / 创意想法的参谋，不执行任何画布命令。
 * 底部输入栏可切换背后的大语言模型（kie Market LLM 白名单，见 lib/chat-models.ts），
 * 助手回复可通过「用作提示词」一键写入选中的生图卡。
 *
 * Session lifecycle: on workflowId change, reuse the newest session bound to
 * this workflow or create one. 头部两个按钮：新建对话（开一个新 session）、
 * 历史对话（列出本画布全部 session 并可切回）；首条消息自动成为会话标题。
 * Sending a message is one synchronous advisor turn (POST messages).
 * 历史消息里遗留的 batchId 仍支持「撤销本轮」。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { ChatMessage, ChatSession } from '@studio/contracts';
import { type WorkflowGraph } from '@studio/domain';
import { zh, COMMAND_TYPE_ZH } from '@/lib/zh-labels';
import { useMe } from '@/lib/use-me';
import { listChatModels, DEFAULT_CHAT_MODEL } from '@/lib/chat-models';
import { Badge, Button, EmptyState, ErrorBanner, Spinner } from '../ui';

const DEFAULT_SESSION_TITLE = '创意参谋';
const DEFAULT_BUDGET_LIMIT = { currency: 'USD', amount: 5 };
const MODEL_STORAGE_KEY = 'studio.chatModel';

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

const SUGGESTIONS: Array<{
  icon: 'flow' | 'run' | 'bg';
  title: string;
  desc: string;
  prompt: string;
  /** fill = 填入输入框等用户补充；send = 直接发送。 */
  action: 'fill' | 'send';
}> = [
  {
    icon: 'flow',
    title: '优化我的提示词',
    desc: '粘贴粗糙想法，改写成可出片的提示词',
    prompt: '帮我优化这条提示词（输出英文、可直接用于生图）：',
    action: 'fill',
  },
  {
    icon: 'bg',
    title: '卖点 → 画面',
    desc: '把产品卖点翻译成画面创意',
    prompt: '帮我把这个产品卖点翻译成 3 个画面创意：',
    action: 'fill',
  },
  {
    icon: 'run',
    title: '给我场景灵感',
    desc: '5 个适合本品的使用场景方向',
    prompt: '给我 5 个适合这款产品主图和 A+ 图的使用场景创意，每个方向附一条英文提示词',
    action: 'send',
  },
];

/** 从助手回复中提取提示词：优先取第一个 ``` 代码块，否则取全文。 */
function extractPromptText(text: string): string {
  const m = text.match(/```[a-z]*\n?([\s\S]*?)```/i);
  return (m ? (m[1] ?? '') : text).trim();
}

/** 历史对话列表的时间显示：今天显时分，否则显 月-日 时分。 */
function formatSessionDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay ? hm : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}

/** content_json is a passthrough object — these extras ride alongside text. */
type AssistantExtra = {
  budgetRejected?: unknown;
  error?: unknown;
};

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
  /** 把助手回复填入底部浮动提示词条。 */
  onUsePrompt?: (text: string) => void;
  /** 收起面板（由外层布局提供）。 */
  onCollapse?: () => void;
}) {
  const { workspaceId, projectId, workflowId, onUsePrompt } = props;
  const getRevisionRef = useRef(props.getRevision);
  getRevisionRef.current = props.getRevision;
  const onGraphChangedRef = useRef(props.onGraphChanged);
  onGraphChangedRef.current = props.onGraphChanged;

  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [undoBusyId, setUndoBusyId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [model, setModel] = useState<string>(() => {
    if (typeof window === 'undefined') return DEFAULT_CHAT_MODEL;
    const stored = window.localStorage.getItem(MODEL_STORAGE_KEY);
    return stored && listChatModels().some((m) => m.slug === stored) ? stored : DEFAULT_CHAT_MODEL;
  });
  const msgsRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const { me } = useMe();
  const userName = me?.email?.split('@')[0] ?? null;
  const chatModels = listChatModels();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<ChatSession[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [newChatBusy, setNewChatBusy] = useState(false);

  const base = `/api/workspaces/${workspaceId}/projects/${projectId}/chat-sessions`;

  const loadSession = useCallback(
    async (sessionId: string): Promise<boolean> => {
      const detailRes = await fetch(`${base}/${sessionId}`);
      const detail = await detailRes.json().catch(() => null);
      if (!detailRes.ok) {
        setError(`会话加载失败：${detail?.error?.message ?? detailRes.status}`);
        return false;
      }
      const { messages: msgs, ...sessionRow } = detail as ChatSession & {
        messages: ChatMessage[];
      };
      setSession(sessionRow);
      setMessages(msgs ?? []);
      return true;
    },
    [base],
  );

  const createSession = useCallback(async (): Promise<boolean> => {
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
      return false;
    }
    return loadSession(created.id as string);
  }, [base, workflowId, loadSession]);

  const initSession = useCallback(async () => {
    if (!workflowId) return;
    setLoading(true);
    setError(null);
    setAuthRequired(false);
    setHint(null);
    setSession(null);
    setMessages([]);
    setHistoryOpen(false);
    try {
      const listRes = await fetch(`${base}?workflowId=${workflowId}`);
      const listJson = await listRes.json().catch(() => null);
      if (!listRes.ok) {
        setError(`会话列表加载失败：${listJson?.error?.message ?? listRes.status}`);
        return;
      }
      const sessionId: string | undefined = listJson?.items?.[0]?.id;
      if (sessionId) {
        await loadSession(sessionId);
      } else {
        await createSession();
      }
    } catch {
      setError('网络错误 — 会话未加载');
    } finally {
      setLoading(false);
    }
  }, [base, workflowId, loadSession, createSession]);

  useEffect(() => {
    void initSession();
  }, [initSession]);

  const startNewChat = useCallback(async () => {
    if (newChatBusy || !workflowId) return;
    setNewChatBusy(true);
    setError(null);
    setHint(null);
    try {
      const ok = await createSession();
      if (ok) {
        setHistoryOpen(false);
        setInput('');
        inputRef.current?.focus();
      }
    } catch {
      setError('网络错误 — 新建对话失败');
    } finally {
      setNewChatBusy(false);
    }
  }, [newChatBusy, workflowId, createSession]);

  const toggleHistory = useCallback(async () => {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const res = await fetch(`${base}?workflowId=${workflowId}`);
      const json = await res.json().catch(() => null);
      if (res.ok) {
        setHistoryItems((json?.items ?? []) as ChatSession[]);
      } else {
        setError(`历史对话加载失败：${json?.error?.message ?? res.status}`);
      }
    } catch {
      setError('网络错误 — 历史对话未加载');
    } finally {
      setHistoryLoading(false);
    }
  }, [historyOpen, base, workflowId]);

  const pickSession = useCallback(
    async (sessionId: string) => {
      if (sessionId === session?.id) {
        setHistoryOpen(false);
        return;
      }
      setError(null);
      setHint(null);
      const ok = await loadSession(sessionId);
      if (ok) setHistoryOpen(false);
    },
    [session?.id, loadSession],
  );

  /** 首条消息成功后，用它自动生成会话标题（静默失败不影响聊天）。 */
  const maybeAutoTitle = useCallback(
    (sessionId: string, firstUserText: string) => {
      const title = firstUserText.replace(/\s+/g, ' ').trim().slice(0, 24);
      if (!title) return;
      void fetch(`${base}/${sessionId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      })
        .then((res) => {
          if (res.ok) {
            setSession((prev) => (prev && prev.id === sessionId ? { ...prev, title } : prev));
          }
        })
        .catch(() => {});
    },
    [base],
  );

  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

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
          body: JSON.stringify({ content, model }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          const code = json?.error?.code as string | undefined;
          if (res.status === 401) {
            // LOCAL_MODE: browsing needs no login; advisor turns do.
            setAuthRequired(true);
            setError('使用参谋需要登录账号');
          } else {
            setAuthRequired(false);
            setError(
              code === 'CHAT_AUTH_FAILED'
                ? '参谋模型认证失败 — 请检查助手模型的密钥配置。'
                : code === 'CHAT_UNAVAILABLE'
                  ? '参谋暂不可用 — 请稍后重试或切换模型。'
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
        setInput('');
        // 首条消息 → 自动给会话起名，历史列表里才好认
        const isFirstUserMsg = !messages.some((m) => m.role === 'USER');
        if (isFirstUserMsg && (!session.title || session.title === DEFAULT_SESSION_TITLE)) {
          maybeAutoTitle(session.id, content);
        }
      } catch {
        setError('网络错误 — 消息未发送');
      } finally {
        setSending(false);
      }
    },
    [base, input, model, sending, session, messages, maybeAutoTitle],
  );

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
    return <EmptyState>画布加载完成后即可与创意参谋对话。</EmptyState>;
  }

  return (
    <>
      <div className="chat-head">
        <strong className="chat-head-title" title={session?.title ?? DEFAULT_SESSION_TITLE}>
          {session?.title ?? DEFAULT_SESSION_TITLE}
        </strong>
        <div className="chat-head-actions">
          <button
            type="button"
            className="chat-icon-btn"
            onClick={() => void startNewChat()}
            disabled={newChatBusy}
            title="新建对话"
            aria-label="新建对话"
          >
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M12 20h8" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" />
            </svg>
          </button>
          <button
            type="button"
            className={historyOpen ? 'chat-icon-btn chat-icon-btn-active' : 'chat-icon-btn'}
            onClick={() => void toggleHistory()}
            title="历史对话"
            aria-label="历史对话"
            aria-expanded={historyOpen}
          >
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M3 3v5h5" />
              <path d="M3.05 13a9 9 0 1 0 .5-5L3 8" />
              <path d="M12 7v5l3.5 2" />
            </svg>
          </button>
          {props.onCollapse ? (
            <button
              type="button"
              className="chat-icon-btn"
              onClick={props.onCollapse}
              title="收起参谋面板"
              aria-label="收起参谋面板"
            >
              ⟨
            </button>
          ) : null}
        </div>
      </div>
      {historyOpen && (
        <div className="chat-history-pop" role="listbox" aria-label="历史对话列表">
          {historyLoading ? (
            <Spinner label="加载历史对话…" />
          ) : historyItems.length === 0 ? (
            <p className="chat-history-empty">还没有历史对话</p>
          ) : (
            historyItems.map((s) => (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={s.id === session?.id}
                className={
                  s.id === session?.id ? 'chat-history-item chat-history-item-active' : 'chat-history-item'
                }
                onClick={() => void pickSession(s.id)}
              >
                <span className="chat-history-item-title">{s.title ?? DEFAULT_SESSION_TITLE}</span>
                <span className="chat-history-item-date">{formatSessionDate(s.createdAt)}</span>
              </button>
            ))
          )}
        </div>
      )}
      {error &&
        (authRequired ? (
          <p role="alert" className="banner-error">
            使用参谋需要登录账号 — <Link href="/login">去登录</Link>
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
                      onClick={() => {
                        if (s.action === 'fill') {
                          setInput(s.prompt);
                          inputRef.current?.focus();
                        } else {
                          void send(s.prompt);
                        }
                      }}
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
                      {onUsePrompt && (
                        <button
                          type="button"
                          className="chat-use-prompt"
                          title="把这条回复（优先取代码块）填入下方提示词条，回车即生成"
                          onClick={() => onUsePrompt(extractPromptText(m.content.text))}
                        >
                          用作提示词
                        </button>
                      )}
                      {m.modelId && <span className="chat-msg-model faint">{m.modelId}</span>}
                      {summary && summary.count > 0 && (
                        <Badge tone="accent">
                          已应用 {summary.count} 条命令（{summarizeTypes(summary.types)}）
                        </Badge>
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
            {sending && <Spinner label="参谋思考中…" />}
          </div>
          <div className="chat-input-box">
            <textarea
              ref={inputRef}
              className="chat-input"
              value={input}
              placeholder="问参谋：优化提示词、要场景创意…（Enter 发送）"
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
              <select
                className="chat-model-select"
                value={model}
                disabled={sending}
                aria-label="切换参谋模型"
                title="切换背后的大语言模型"
                onChange={(e) => {
                  setModel(e.target.value);
                  try {
                    window.localStorage.setItem(MODEL_STORAGE_KEY, e.target.value);
                  } catch {
                    /* 隐私模式写入失败忽略 */
                  }
                }}
              >
                {chatModels.map((m) => (
                  <option key={m.slug} value={m.slug}>
                    {m.label}
                  </option>
                ))}
              </select>
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
