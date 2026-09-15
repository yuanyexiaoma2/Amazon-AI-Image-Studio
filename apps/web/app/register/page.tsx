'use client';

import { FormEvent, useState } from 'react';
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
    <div className="container">
      <h1>注册</h1>
      <form onSubmit={onSubmit} className="stack" style={{ maxWidth: 360 }}>
        <label>
          姓名（可选）
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          邮箱
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
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
    </div>
  );
}
