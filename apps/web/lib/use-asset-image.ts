'use client';

/**
 * V2 PR-1 — signed asset image URLs with caching + pre-refresh.
 * GET .../asset-versions/{id}/download-url?kind=… returns a 900s signed
 * URL; entries are cached per (workspaceId, versionId, kind) so list
 * scrolling does not refetch, and re-fetched at 800s before expiry.
 * Timers and state updates are cleaned up on unmount.
 */
import { useEffect, useState } from 'react';

export type AssetImageKind = 'THUMBNAIL_WEBP' | 'NORMALIZED_PNG';

const REFRESH_MS = 800_000;

type CacheEntry = { url: string; fetchedAt: number };
const cache = new Map<string, CacheEntry>();

export type AssetImageState = {
  url: string | null;
  loading: boolean;
  error: string | null;
};

export function useAssetImage(
  workspaceId: string | null,
  versionId: string | null,
  kind: AssetImageKind = 'THUMBNAIL_WEBP',
): AssetImageState {
  const [state, setState] = useState<AssetImageState>({
    url: null,
    loading: Boolean(workspaceId && versionId),
    error: null,
  });

  useEffect(() => {
    if (!workspaceId || !versionId) {
      setState({ url: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const key = `${workspaceId}:${versionId}:${kind}`;

    async function load() {
      const hit = cache.get(key);
      if (hit && Date.now() - hit.fetchedAt < REFRESH_MS) {
        setState({ url: hit.url, loading: false, error: null });
      } else {
        setState((s) => ({ url: s.url, loading: true, error: null }));
        try {
          const res = await fetch(
            `/api/workspaces/${workspaceId}/asset-versions/${versionId}/download-url?kind=${kind}`,
          );
          const json = await res.json().catch(() => null);
          if (cancelled) return;
          if (!res.ok) {
            setState({
              url: null,
              loading: false,
              error: json?.error?.message ?? `HTTP ${res.status}`,
            });
            return;
          }
          cache.set(key, { url: json.url as string, fetchedAt: Date.now() });
          setState({ url: json.url as string, loading: false, error: null });
        } catch (e) {
          if (!cancelled) {
            setState({
              url: null,
              loading: false,
              error: e instanceof Error ? e.message : String(e),
            });
            return;
          }
        }
      }
      // Pre-refresh before the 900s signature expires.
      timer = setTimeout(() => {
        cache.delete(key);
        void load();
      }, REFRESH_MS);
    }

    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [workspaceId, versionId, kind]);

  return state;
}
