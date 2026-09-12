'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

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
      setError(data?.error?.message ?? 'Registration failed');
      return;
    }
    router.push('/login');
  }

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <h1>Register</h1>
      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12, maxWidth: 360 }}>
        <label>
          Name (optional)
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ display: 'block', width: '100%', padding: 8 }}
          />
        </label>
        <label>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ display: 'block', width: '100%', padding: 8 }}
          />
        </label>
        <label>
          Password (min 12)
          <input
            type="password"
            required
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ display: 'block', width: '100%', padding: 8 }}
          />
        </label>
        {error ? <p style={{ color: '#ff8f8f' }}>{error}</p> : null}
        <button type="submit" disabled={loading} style={{ padding: 10 }}>
          {loading ? 'Creating…' : 'Create account'}
        </button>
      </form>
    </div>
  );
}
