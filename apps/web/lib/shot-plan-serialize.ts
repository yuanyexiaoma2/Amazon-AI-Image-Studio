import { sortBriefsForCanvas, type ShotBriefSlot } from '@studio/domain';

type BriefRow = {
  id: string;
  slot: string;
  purpose: string;
  orderIndex: number;
  copyJson: unknown;
  constraintsJson: unknown;
};

type RevisionWithBriefs = {
  id: string;
  revision: number;
  status: string;
  truthRevisionId: string;
  provider: string | null;
  modelId: string | null;
  approvedAt: Date | null;
  approvedByUserId: string | null;
  briefs: BriefRow[];
};

function parseConstraints(raw: unknown) {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const target = (c.targetPixels && typeof c.targetPixels === 'object'
    ? c.targetPixels
    : { width: 2000, height: 2000 }) as { width?: number; height?: number };
  return {
    must: Array.isArray(c.must) ? (c.must as string[]) : [],
    mustNot: Array.isArray(c.mustNot) ? (c.mustNot as string[]) : [],
    qaPolicy: typeof c.qaPolicy === 'string' ? c.qaPolicy : 'amazon-generic-us-v1',
    aspectRatio: typeof c.aspectRatio === 'string' ? c.aspectRatio : '1:1',
    targetPixels: {
      width: typeof target.width === 'number' ? target.width : 2000,
      height: typeof target.height === 'number' ? target.height : 2000,
    },
    referencedAssetVersionIds: Array.isArray(c.referencedAssetVersionIds)
      ? (c.referencedAssetVersionIds as string[])
      : [],
  };
}

export function serializeShotPlan(args: {
  documentId: string;
  projectId: string;
  workspaceId: string;
  currentRevisionId: string | null;
  approvedRevisionId: string | null;
  revision: RevisionWithBriefs | null;
}) {
  const revision = args.revision
    ? {
        id: args.revision.id,
        revision: args.revision.revision,
        status: args.revision.status,
        truthRevisionId: args.revision.truthRevisionId,
        provider: args.revision.provider,
        modelId: args.revision.modelId,
        briefs: args.revision.briefs.map((b) => ({
          id: b.id,
          slot: b.slot,
          purpose: b.purpose,
          orderIndex: b.orderIndex,
          copy: Array.isArray(b.copyJson) ? b.copyJson : [],
          constraints: parseConstraints(b.constraintsJson),
        })),
        approvedAt: args.revision.approvedAt?.toISOString() ?? null,
        approvedByUserId: args.revision.approvedByUserId,
      }
    : null;

  const canvasPayload =
    revision == null
      ? null
      : {
          planDocumentId: args.documentId,
          planRevisionId: revision.id,
          projectId: args.projectId,
          workspaceId: args.workspaceId,
          truthRevisionId: revision.truthRevisionId,
          briefs: sortBriefsForCanvas(
            revision.briefs.map((b) => ({
              briefId: b.id,
              slot: b.slot as ShotBriefSlot,
              purpose: b.purpose,
              orderIndex: b.orderIndex,
              aspectRatio: b.constraints.aspectRatio,
              targetPixels: b.constraints.targetPixels,
              copy: b.copy,
              must: b.constraints.must,
              mustNot: b.constraints.mustNot,
              qaPolicy: b.constraints.qaPolicy,
              referencedAssetVersionIds: b.constraints.referencedAssetVersionIds,
            })),
          ),
        };

  return {
    documentId: args.documentId,
    projectId: args.projectId,
    currentRevisionId: args.currentRevisionId,
    approvedRevisionId: args.approvedRevisionId,
    revision,
    canvasPayload,
  };
}
