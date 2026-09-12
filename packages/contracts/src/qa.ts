import { z } from 'zod';

export const DispatchQaRequestSchema = z.object({
  policyKey: z.string().min(1).max(80).optional().default('amazon-main-us-v1'),
  slot: z.enum(['MAIN', 'FEATURE', 'DETAIL', 'DIMENSION', 'LIFESTYLE', 'PACKAGE']).optional(),
  shotBriefId: z.string().uuid().optional(),
  truthRevisionId: z.string().uuid().optional(),
  workflowRevisionId: z.string().uuid().optional(),
  /** Fake-only OCR scenario (SUCCESS | OVERLAY_TEXT | FACT_MISMATCH | LOW_CONFIDENCE). */
  ocrScenario: z.string().max(40).optional(),
  /** Fake-only Vision QA scenario. */
  visionScenario: z.string().max(40).optional(),
});

export type DispatchQaRequest = z.infer<typeof DispatchQaRequestSchema>;

export const CreateApprovalRequestSchema = z.object({
  qaReportId: z.string().uuid(),
  decision: z.enum(['APPROVE', 'REJECT', 'OVERRIDE_BLOCK', 'REVOKE']),
  reason: z.string().max(2000).optional(),
  shotBriefRevisionId: z.string().uuid().optional(),
  workflowRevisionId: z.string().uuid().optional(),
});

export type CreateApprovalRequest = z.infer<typeof CreateApprovalRequestSchema>;

export const QaFindingSchema = z.object({
  id: z.string().uuid().optional(),
  ruleId: z.string(),
  ruleVersion: z.number().int(),
  evaluator: z.string(),
  status: z.enum(['PASS', 'REVIEW', 'FAIL']),
  severity: z.string(),
  nonWaivable: z.boolean(),
  score: z.number().nullable().optional(),
  message: z.string(),
  evidence: z.record(z.unknown()),
  suggestedAction: z.string().nullable().optional(),
});

export const QaReportSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  assetVersionId: z.string().uuid(),
  slot: z.string().nullable(),
  status: z.string(),
  overallStatus: z.enum(['PASS', 'REVIEW', 'BLOCK']).nullable(),
  rulePackKey: z.string(),
  rulePackVersion: z.number().int(),
  rulePackSha256: z.string(),
  inputFingerprint: z.string().nullable().optional(),
  findings: z.array(QaFindingSchema),
  disclaimer:
    z.string().optional(),
});

export const ApprovalSchema = z.object({
  id: z.string().uuid(),
  assetVersionId: z.string().uuid(),
  qaReportId: z.string().uuid(),
  decision: z.enum(['APPROVE', 'REJECT', 'OVERRIDE_BLOCK', 'REVOKE']),
  actorUserId: z.string().uuid(),
  actorRole: z.string(),
  reason: z.string().nullable(),
  decidedAt: z.string(),
});
