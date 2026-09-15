'use client';

/**
 * V2 PR-2 — async data sources for the config-panel dropdowns.
 * Assets / truth revision / shot briefs / models load on mount and whenever
 * the selected node changes (entering the panel); masks load whenever the
 * graph's source_image assetVersionId changes.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  AssetOptionItem,
  BriefOptionItem,
  MaskOptionItem,
  ModelOptionItem,
  TruthRevisionItem,
} from './config-options';

export type ConfigOptionsData = {
  /** null while the first load is in flight. */
  assets: AssetOptionItem[] | null;
  /** undefined while loading; null when the project has no truth revision. */
  truthRevision: TruthRevisionItem | null | undefined;
  briefs: BriefOptionItem[] | null;
  models: ModelOptionItem[] | null;
  /** null while loading or when no source asset version is selected. */
  masks: MaskOptionItem[] | null;
  reload: () => void;
  reloadMasks: () => void;
};

export function useConfigOptions(args: {
  workspaceId: string;
  projectId: string;
  sourceAssetVersionId: string | null;
  /** Refetch static sources when the panel selection changes. */
  activeNodeId: string | null;
}): ConfigOptionsData {
  const { workspaceId, projectId, sourceAssetVersionId, activeNodeId } = args;
  const [assets, setAssets] = useState<AssetOptionItem[] | null>(null);
  const [truthRevision, setTruthRevision] = useState<TruthRevisionItem | null | undefined>(
    undefined,
  );
  const [briefs, setBriefs] = useState<BriefOptionItem[] | null>(null);
  const [models, setModels] = useState<ModelOptionItem[] | null>(null);
  const [masks, setMasks] = useState<MaskOptionItem[] | null>(null);

  const reload = useCallback(() => {
    void (async () => {
      const [aRes, tRes, sRes, mRes] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/assets`).catch(() => null),
        fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/truth-pack`).catch(() => null),
        fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/shot-plans`).catch(() => null),
        fetch(`/api/workspaces/${workspaceId}/model-registry`).catch(() => null),
      ]);
      const aJson = aRes ? await aRes.json().catch(() => null) : null;
      const tJson = tRes ? await tRes.json().catch(() => null) : null;
      const sJson = sRes ? await sRes.json().catch(() => null) : null;
      const mJson = mRes ? await mRes.json().catch(() => null) : null;
      setAssets(aRes?.ok ? (aJson?.items ?? []) : []);
      setTruthRevision(tRes?.ok ? (tJson?.revision ?? null) : null);
      setBriefs(sRes?.ok ? (sJson?.revision?.briefs ?? []) : []);
      setModels(mRes?.ok ? (mJson?.models ?? []) : []);
    })();
  }, [workspaceId, projectId]);

  const reloadMasks = useCallback(() => {
    if (!sourceAssetVersionId) {
      setMasks(null);
      return;
    }
    void (async () => {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/asset-versions/${sourceAssetVersionId}/masks`,
      ).catch(() => null);
      const json = res ? await res.json().catch(() => null) : null;
      setMasks(res?.ok ? (json?.items ?? []) : []);
    })();
  }, [workspaceId, sourceAssetVersionId]);

  useEffect(() => {
    reload();
  }, [reload, activeNodeId]);

  useEffect(() => {
    reloadMasks();
  }, [reloadMasks]);

  return { assets, truthRevision, briefs, models, masks, reload, reloadMasks };
}
