'use client';

import { FormEvent, useState } from 'react';
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
    <div className="container">
      <h1>登录</h1>
      <form onSubmit={onSubmit} className="stack" style={{ maxWidth: 360 }}>
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
    </div>
  );
}
