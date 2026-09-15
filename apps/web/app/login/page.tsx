'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button, ErrorBanner, Input } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setError('登录失败。请检查邮箱/密码。');
      return;
    }
    router.push('/');
    router.refresh();
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1 className="auth-title">登录</h1>
        <p className="auth-sub">登录 Amazon AI Image Studio 继续工作</p>
        <form onSubmit={onSubmit} className="stack">
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
            密码
            <Input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error ? <ErrorBanner message={error} /> : null}
          <Button type="submit" variant="primary" size="lg" disabled={loading}>
            {loading ? '登录中…' : '登录'}
          </Button>
        </form>
        <p className="auth-alt">
          还没有账号？<Link href="/register">注册</Link>
        </p>
      </div>
    </div>
  );
}
