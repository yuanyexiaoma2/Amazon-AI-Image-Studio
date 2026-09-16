'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, ErrorBanner, Input } from '@/components/ui';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name: name || undefined }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? '注册失败');
      return;
    }
    router.push('/login');
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1 className="auth-title">创建账号</h1>
        <p className="auth-sub">注册亚马逊 AI 生图工作台，开始生成商品图</p>
        <form onSubmit={onSubmit} className="stack">
          <label className="form-field">
            姓名（可选）
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="form-field">
            邮箱
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="form-field">
            密码（至少 12 位）
            <Input
              type="password"
              required
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error ? <ErrorBanner message={error} /> : null}
          <Button type="submit" variant="primary" size="lg" disabled={loading}>
            {loading ? '创建中…' : '创建账号'}
          </Button>
        </form>
        <p className="auth-alt">
          已有账号？<Link href="/login">登录</Link>
        </p>
      </div>
    </div>
  );
}
