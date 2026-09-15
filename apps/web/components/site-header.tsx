'use client';

/**
 * V2 PR-1 — site header with login state: current user email + workspace
 * name (from /api/me), Admin entry for OWNER/ADMIN, sign-out button.
 * Replaces the inline header previously hard-coded in app/layout.tsx.
 */
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useMe } from '@/lib/use-me';
import { Badge, Button } from '@/components/ui';

export function SiteHeader() {
  const { me, loading } = useMe();
  const search = useSearchParams();
  const workspaceId = search.get('workspaceId');
  const workspace =
    me?.workspaces.find((w) => w.id === workspaceId) ?? me?.workspaces[0] ?? null;
  const isAdmin = me?.workspaces.some((w) => w.role === 'OWNER' || w.role === 'ADMIN') ?? false;

  return (
    <header className="site-header">
      <Link href="/" style={{ color: 'var(--text)', textDecoration: 'none' }}>
        <strong>Amazon AI Image Studio</strong>
      </Link>
      <nav className="site-nav">
        {loading ? null : me ? (
          <>
            <Link href="/projects">项目</Link>
            {isAdmin ? <Link href="/admin">Admin</Link> : null}
            {workspace ? (
              <Badge tone="accent">
                {workspace.name} · {workspace.role}
              </Badge>
            ) : null}
            <span className="muted" style={{ fontSize: 'var(--font-size-sm)' }}>
              {me.email}
            </span>
            <Button onClick={() => void signOut({ callbackUrl: '/' })}>退出登录</Button>
          </>
        ) : (
          <>
            <Link href="/login">登录</Link>
            <Link href="/register">注册</Link>
          </>
        )}
      </nav>
    </header>
  );
}
