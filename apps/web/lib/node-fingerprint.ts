import {
  AUTO_MODEL_KEY,
  FAKE_PRIMARY_MODEL,
  computeInputFingerprint,
  extractImageAssetVersionId,
  extractMaskId,
  extractPromptFromInputs,
  extractReferenceAssetVersionIds,
  extractTruthRevisionId,
  extractUpscaleParams,
  getModelByKey,
  operationForNodeType,
  resolveAutoModelKey,
  resolveModelRegistry,
  resolvePortInputs,
  type ModelRegistryEntry,
  type WorkflowGraph,
} from '@studio/domain';

/**
 * node-results 路由的 stale 判定需要拿「当前 draft 图」重算节点指纹，
 * 与 NodeResult 行里存的 inputFingerprint 对比。
 *
 * 本文件镜像 packages/db/src/repositories/generation.ts createRun 里的
 * 指纹输入组装（resolvePortInputs → prompt/truth/references/image/mask →
 * 模型解析 → assetVersion.sha256 / mask representationSha256 →
 * computeInputFingerprint）。两边各自实现、以 db 侧为准：
 * 这里算出的指纹只用于「是否过期」提示，不参与复用决策。
 */

/** 结构化最小 db 接口（prisma 客户端直接满足）。 */
export type FingerprintDb = {
  assetVersion: {
    findMany(args: {
      where: { id: { in: string[] }; workspaceId: string };
      select: { id: true; sha256: true };
    }): Promise<Array<{ id: string; sha256: string }>>;
  };
  mask: {
    findMany(args: {
      where: { id: { in: string[] }; workspaceId: string; deletedAt: null };
      select: { id: true; metadataJson: true; strokesJson: true };
    }): Promise<Array<{ id: string; metadataJson: unknown; strokesJson: unknown }>>;
  };
};

type NodeFingerprintInputs = {
  refIds: string[];
  portIdByAssetVersionId: Map<string, string>;
  maskId: string | null;
  truthRevisionId: string | null;
  shotBriefId: string | null;
  prompt: string;
  negativePrompt: string;
  modelConfigVersion: number;
};

function collectNodeInputs(
  graph: WorkflowGraph,
  node: WorkflowGraph['nodes'][number],
  defaultKey: string,
  registry: ModelRegistryEntry[],
  fallbackModel: ModelRegistryEntry,
): NodeFingerprintInputs {
  const op = operationForNodeType(node.type) ?? 'GENERATE';
  const inputs = resolvePortInputs(graph, node.id);
  const { prompt, negativePrompt, shotBriefId } = extractPromptFromInputs(node, inputs);
  const truthRevisionId = extractTruthRevisionId(node, inputs);
  const refIds = [...extractReferenceAssetVersionIds(inputs)];
  const imageVersionId = extractImageAssetVersionId(inputs);
  if (imageVersionId && !refIds.includes(imageVersionId)) {
    refIds.push(imageVersionId);
  }
  const portIdByAssetVersionId = new Map<string, string>();
  for (const input of inputs) {
    const avId = (input.sourceConfig as { assetVersionId?: unknown }).assetVersionId;
    if (typeof avId === 'string' && !portIdByAssetVersionId.has(avId)) {
      portIdByAssetVersionId.set(avId, input.portId);
    }
  }
  const maskId = extractMaskId(node, inputs);
  const needsReferences = op !== 'GENERATE' || refIds.length > 0;
  let configModelKey =
    typeof node.config?.modelKey === 'string' ? node.config.modelKey : undefined;
  if (configModelKey === AUTO_MODEL_KEY) {
    configModelKey = resolveAutoModelKey(needsReferences, registry);
  }
  const upscaleEngineKey =
    node.type === 'upscale' ? extractUpscaleParams(node)?.engineKey : undefined;
  const nodeModel =
    getModelByKey(configModelKey ?? upscaleEngineKey ?? defaultKey, registry) ?? fallbackModel;
  return {
    refIds,
    portIdByAssetVersionId,
    maskId,
    truthRevisionId,
    shotBriefId,
    prompt,
    negativePrompt,
    modelConfigVersion: nodeModel.configVersion,
  };
}

/**
 * 对 draft 图每个节点重算 inputFingerprint；返回 nodeId → sha256。
 * provider/defaultKey 解析与 db createRun 保持一致（IMAGE_PROVIDER）。
 */
export async function computeDraftNodeFingerprints(
  db: FingerprintDb,
  workspaceId: string,
  graph: WorkflowGraph,
): Promise<Record<string, string>> {
  const registry = resolveModelRegistry(process.env.IMAGE_PROVIDER);
  const provider = (process.env.IMAGE_PROVIDER ?? 'fake').trim().toLowerCase();
  const defaultKey =
    provider === 'kie' || provider === 'kie.ai' || provider === 'kieai'
      ? 'kie-nano-banana-2'
      : FAKE_PRIMARY_MODEL.key;
  const fallbackModel = getModelByKey(defaultKey, registry) ?? FAKE_PRIMARY_MODEL;

  const perNode = graph.nodes.map((node) => ({
    node,
    inputs: collectNodeInputs(graph, node, defaultKey, registry, fallbackModel),
  }));

  const allAssetVersionIds = [...new Set(perNode.flatMap((p) => p.inputs.refIds))];
  const allMaskIds = [
    ...new Set(perNode.map((p) => p.inputs.maskId).filter((v): v is string => !!v)),
  ];
  const [assetRows, maskRows] = await Promise.all([
    allAssetVersionIds.length > 0
      ? db.assetVersion.findMany({
          where: { id: { in: allAssetVersionIds }, workspaceId },
          select: { id: true, sha256: true },
        })
      : Promise.resolve([]),
    allMaskIds.length > 0
      ? db.mask.findMany({
          where: { id: { in: allMaskIds }, workspaceId, deletedAt: null },
          select: { id: true, metadataJson: true, strokesJson: true },
        })
      : Promise.resolve([]),
  ]);
  const shaByAssetVersionId = new Map(assetRows.map((r) => [r.id, r.sha256]));
  const maskById = new Map(maskRows.map((r) => [r.id, r]));

  const result: Record<string, string> = {};
  for (const { node, inputs } of perNode) {
    const unknownFields: string[] = [];
    const upstreamAssets = inputs.refIds.map((avId, i) => {
      const sha256 = shaByAssetVersionId.get(avId);
      if (sha256 === undefined) unknownFields.push(`upstreamAssets[${i}].sha256`);
      return {
        portId: inputs.portIdByAssetVersionId.get(avId) ?? 'references',
        order: i,
        assetVersionId: avId,
        sha256: sha256 ?? 'unknown',
      };
    });
    const masks: Array<{ maskId: string; representationSha256: string }> = [];
    if (inputs.maskId) {
      const maskRow = maskById.get(inputs.maskId);
      if (!maskRow) {
        unknownFields.push('masks[0].representationSha256');
        masks.push({ maskId: inputs.maskId, representationSha256: 'unknown' });
      } else {
        const meta = (maskRow.metadataJson ?? {}) as Record<string, unknown>;
        const sha =
          typeof meta.renderedSha256 === 'string'
            ? meta.renderedSha256
            : typeof meta.maskAssetVersionId === 'string'
              ? 'pending-render'
              : 'strokes-only';
        masks.push({
          maskId: inputs.maskId,
          representationSha256:
            sha === 'pending-render' || sha === 'strokes-only'
              ? `strokes:${JSON.stringify(maskRow.strokesJson).slice(0, 64)}`
              : sha,
        });
      }
    }
    const fp = computeInputFingerprint({
      nodeType: node.type,
      nodeConfig: (node.config ?? {}) as Record<string, unknown>,
      upstreamAssets,
      masks,
      truthRevisionId: inputs.truthRevisionId,
      shotBriefRevisionId: inputs.shotBriefId,
      prompt: inputs.prompt,
      negativePrompt: inputs.negativePrompt,
      modelRegistryConfigVersion: inputs.modelConfigVersion,
      unknownFields,
    });
    result[node.id] = fp.sha256;
  }
  return result;
}
