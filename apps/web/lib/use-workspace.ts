'use client';

/**
 * V2 PR-1 — workspace context resolution.
 * Priority: ?workspaceId= query param → localStorage-remembered choice →
 * first workspace from /api/me. The resolved id is remembered in
 * localStorage so single-workspace flows work without query params.
 */
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMe } from './use-me';

const LS_KEY = 'studio.workspaceId';

export function useWorkspace(): {
  workspaceId: string | null;
  loading: boolean;
  projectHref: (path: string) => string;
} {
  const search = useSearchParams();
  const paramId = search.get('workspaceId');
  const { me, loading: meLoading } = useMe();
  const [remembered, setRemembered] = useState<string | null>(null);

  useEffect(() => {
    setRemembered(window.localStorage.getItem(LS_KEY));
  }, []);

  const rememberedValid =
    remembered && me?.workspaces.some((w) => w.id === remembered) ? remembered : null;
  const workspaceId = paramId ?? rememberedValid ?? me?.workspaces[0]?.id ?? null;

  useEffect(() => {
    if (workspaceId) window.localStorage.setItem(LS_KEY, workspaceId);
  }, [workspaceId]);

  const projectHref = (path: string) =>
    workspaceId ? `${path}${path.includes('?') ? '&' : '?'}workspaceId=${workspaceId}` : path;

  return { workspaceId, loading: !paramId && meLoading, projectHref };
}
