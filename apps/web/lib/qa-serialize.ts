const QA_DISCLAIMER =
  'Automatic QA is a pre-publish assistant check. It is not Amazon acceptance, legal advice, or an IP conclusion. Category rules may override the generic pack; operators make the final call.';

export function serializeQaReport(report: {
  id: string;
  projectId: string;
  assetVersionId: string;
  slot: string | null;
  status: string;
  overallStatus: string | null;
  rulePackKey: string;
  rulePackVersion: number;
  rulePackSha256: string;
  inputFingerprint?: string | null;
  truthRevisionId?: string | null;
  findings: Array<{
    id: string;
    ruleId: string;
    ruleVersion: number;
    evaluator: string;
    status: string;
    severity: string;
    nonWaivable: boolean;
    score: number | null;
    message: string;
    evidenceJson: unknown;
    suggestedAction: string | null;
  }>;
}) {
  return {
    id: report.id,
    projectId: report.projectId,
    assetVersionId: report.assetVersionId,
    slot: report.slot,
    status: report.status,
    overallStatus: report.overallStatus,
    rulePackKey: report.rulePackKey,
    rulePackVersion: report.rulePackVersion,
    rulePackSha256: report.rulePackSha256,
    inputFingerprint: report.inputFingerprint ?? null,
    truthRevisionId: report.truthRevisionId ?? null,
    findings: report.findings.map((f) => ({
      id: f.id,
      ruleId: f.ruleId,
      ruleVersion: f.ruleVersion,
      evaluator: f.evaluator,
      status: f.status,
      severity: f.severity,
      nonWaivable: f.nonWaivable,
      score: f.score,
      message: f.message,
      evidence: f.evidenceJson,
      suggestedAction: f.suggestedAction,
    })),
    disclaimer: QA_DISCLAIMER,
  };
}

export function serializeApproval(row: {
  id: string;
  assetVersionId: string;
  qaReportId: string;
  decision: string;
  actorUserId: string;
  actorRole: string;
  reason: string | null;
  decidedAt: Date;
  truthRevisionId: string;
}) {
  return {
    id: row.id,
    assetVersionId: row.assetVersionId,
    qaReportId: row.qaReportId,
    decision: row.decision,
    actorUserId: row.actorUserId,
    actorRole: row.actorRole,
    reason: row.reason,
    decidedAt: row.decidedAt.toISOString(),
    truthRevisionId: row.truthRevisionId,
  };
}

export function serializeExportBundle(bundle: {
  id: string;
  projectId: string;
  status: string;
  sku: string;
  marketplaceCode: string;
  rulePackKey: string;
  rulePackVersion: number;
  manifestSha256: string | null;
  zipSha256: string | null;
  zipBytes: number | null;
  createdAt: Date;
  errorJson?: unknown;
  items: Array<{
    assetVersionId: string;
    qaReportId: string;
    approvalId: string;
    slot: string;
    variantCode: string;
    path: string;
  }>;
}) {
  return {
    id: bundle.id,
    projectId: bundle.projectId,
    status: bundle.status,
    sku: bundle.sku,
    marketplaceCode: bundle.marketplaceCode,
    rulePackKey: bundle.rulePackKey,
    rulePackVersion: bundle.rulePackVersion,
    manifestSha256: bundle.manifestSha256,
    zipSha256: bundle.zipSha256,
    zipBytes: bundle.zipBytes,
    createdAt: bundle.createdAt.toISOString(),
    error: bundle.errorJson ?? null,
    items: bundle.items,
  };
}
