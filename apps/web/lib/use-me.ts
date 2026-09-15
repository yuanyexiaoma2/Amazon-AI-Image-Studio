'use client';

/**
 * V2 PR-1 — tiny SWR-style /api/me cache (no new dependency).
 * Shared module-level cache + single inflight fetch; components re-render
 * when the value resolves. `refresh()` busts the cache (e.g. after login).
 */
import { useEffect, useState } from 'react';

export type MeWorkspace = { id: string; name: string; role: string };

export type Me = {
  id: string;
  email: string;
  sessionVersion: number;
  workspaces: MeWorkspace[];
};

type CacheValue = { me: Me | null };

let cached: CacheValue | undefined;
let inflight: Promise<CacheValue> | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

async function fetchMe(): Promise<CacheValue> {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) return { me: null };
    return { me: (await res.json()) as Me };
  } catch {
    return { me: null };
  }
}

export function useMe(): { me: Me | null; loading: boolean; refresh: () => void } {
  const [value, setValue] = useState<CacheValue | undefined>(cached);

  useEffect(() => {
    const listener = () => setValue(cached);
    listeners.add(listener);
    if (!cached) {
      if (!inflight) {
        inflight = fetchMe().then((v) => {
          cached = v;
          inflight = null;
          notify();
          return v;
        });
      }
      void inflight;
    }
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return {
    me: value?.me ?? null,
    loading: value === undefined,
    refresh: () => {
      cached = undefined;
      inflight = fetchMe().then((v) => {
        cached = v;
        inflight = null;
        notify();
        return v;
      });
      notify();
    },
  };
}
