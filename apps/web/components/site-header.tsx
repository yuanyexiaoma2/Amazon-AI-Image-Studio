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
      <Link href="/" className="site-brand">
        Amazon AI Image Studio
      </Link>
      <nav className="site-nav">
        {loading ? null : me?.localMode ? (
          <>
            <Link href="/projects">项目</Link>
            <Link href="/admin">Admin</Link>
            {workspace ? <Badge tone="accent">{workspace.name}</Badge> : null}
            <Badge>本地工作台</Badge>
            {me.authenticated ? (
              <span className="muted" style={{ fontSize: 'var(--font-size-sm)' }}>
                已登录，可生图
              </span>
            ) : (
              <Link href="/login">登录（生图需要）</Link>
            )}
          </>
        ) : me ? (
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
