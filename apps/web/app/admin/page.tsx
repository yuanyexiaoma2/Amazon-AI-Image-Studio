'use client';

import { useCallback, useEffect, useState } from 'react';

type Balances = {
  availableMicrounits: number;
  heldMicrounits: number;
  consumedMicrounits: number;
};

/**
 * W7-06 Admin Jobs + credit adjust + cost reconciliation (OWNER/ADMIN).
 * Workspace id is read from ?workspaceId= query (ops bookmark).
 */
export default function AdminPage() {
  const [workspaceId, setWorkspaceId] = useState('');
  const [jobs, setJobs] = useState<unknown>(null);
  const [credits, setCredits] = useState<{ balances: Balances; events: unknown[] } | null>(null);
  const [recon, setRecon] = useState<unknown>(null);
  const [adjustNote, setAdjustNote] = useState('运维充值');
  const [adjustAmount, setAdjustAmount] = useState('1000000');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('workspaceId');
    if (q) setWorkspaceId(q);
  }, []);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setError(null);
    try {
      const [j, c, r] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/admin/jobs`),
        fetch(`/api/workspaces/${workspaceId}/admin/credits`),
        fetch(`/api/workspaces/${workspaceId}/admin/reconciliation`),
      ]);
      if (!j.ok || !c.ok || !r.ok) {
        const body = await j.json().catch(() => ({}));
        setError(body?.error?.message ?? `HTTP ${j.status}/${c.status}/${r.status}`);
        return;
      }
      setJobs(await j.json());
      setCredits(await c.json());
      setRecon(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onAdjust() {
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/workspaces/${workspaceId}/admin/credits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        microunits: Number(adjustAmount),
        note: adjustNote,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json?.error?.message ?? `调整失败 ${res.status}`);
      return;
    }
    setMessage(`已调整 +${adjustAmount} 微单位`);
    await load();
  }

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui', maxWidth: 1100 }}>
      <h1>管理后台 — 任务 / 积分 / 对账</h1>
      <p style={{ color: '#555' }}>仅 OWNER/ADMIN（W7-06）。Fake 账本 — ADR-0003。</p>
      <label>
        工作空间 ID{' '}
        <input
          value={workspaceId}
          onChange={(e) => setWorkspaceId(e.target.value)}
          style={{ width: 360 }}
        />
      </label>{' '}
      <button type="button" onClick={() => void load()}>
        刷新
      </button>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {message && <p style={{ color: 'green' }}>{message}</p>}

      <section style={{ marginTop: 24 }}>
        <h2>积分调整</h2>
        <input
          value={adjustAmount}
          onChange={(e) => setAdjustAmount(e.target.value)}
          style={{ width: 160 }}
        />{' '}
        微单位{' '}
        <input
          value={adjustNote}
          onChange={(e) => setAdjustNote(e.target.value)}
          style={{ width: 280 }}
        />{' '}
        <button type="button" onClick={() => void onAdjust()}>
          调整
        </button>
        {credits && (
          <pre style={{ background: '#f6f6f6', padding: 12 }}>
            {JSON.stringify(credits.balances, null, 2)}
          </pre>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>成本对账</h2>
        <pre style={{ background: '#f6f6f6', padding: 12, maxHeight: 280, overflow: 'auto' }}>
          {JSON.stringify(recon, null, 2)}
        </pre>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>任务</h2>
        <pre style={{ background: '#f6f6f6', padding: 12, maxHeight: 420, overflow: 'auto' }}>
          {JSON.stringify(jobs, null, 2)}
        </pre>
      </section>
    </main>
  );
}
