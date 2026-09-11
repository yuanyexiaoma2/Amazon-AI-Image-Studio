type FactRow = {
  id: string;
  key: string;
  valueJson: unknown;
  confidence: number;
  status: string;
  evidenceAssetVersionIds: unknown;
};

type ConstraintRow = {
  id: string;
  kind: string;
  path: string;
  rule: string;
  severity: string;
};

type RevisionWithDetails = {
  id: string;
  revision: number;
  status: string;
  approvedAt: Date | null;
  approvedByUserId: string | null;
  facts: FactRow[];
  constraints: ConstraintRow[];
};

export function serializeTruthPack(args: {
  documentId: string;
  projectId: string;
  currentRevisionId: string | null;
  approvedRevisionId: string | null;
  revision: RevisionWithDetails | null;
}) {
  return {
    documentId: args.documentId,
    projectId: args.projectId,
    currentRevisionId: args.currentRevisionId,
    approvedRevisionId: args.approvedRevisionId,
    revision: args.revision
      ? {
          id: args.revision.id,
          revision: args.revision.revision,
          status: args.revision.status,
          facts: args.revision.facts.map((f) => ({
            id: f.id,
            key: f.key,
            value: f.valueJson,
            confidence: f.confidence,
            status: f.status,
            evidenceAssetVersionIds: Array.isArray(f.evidenceAssetVersionIds)
              ? (f.evidenceAssetVersionIds as string[])
              : [],
          })),
          constraints: args.revision.constraints.map((c) => ({
            id: c.id,
            kind: c.kind,
            path: c.path,
            rule: c.rule,
            severity: c.severity,
          })),
          approvedAt: args.revision.approvedAt?.toISOString() ?? null,
          approvedByUserId: args.revision.approvedByUserId,
        }
      : null,
  };
}
