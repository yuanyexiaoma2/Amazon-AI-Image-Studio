/**
 * QA Finding schema + tri-state aggregation (spec §11.4 / §11.5 / §31.14).
 * Finding FAIL ≠ human reject. Report PASS ≠ human Approval.
 */

import { canonicalizeJcs } from './jcs.js';
import { sha256Hex } from './sha256.js';
import type { RuleSeverity } from './qa-rule-pack.js';

export const QA_FINDING_STATUSES = ['PASS', 'REVIEW', 'FAIL'] as const;
export type QaFindingStatus = (typeof QA_FINDING_STATUSES)[number];

export const QA_REPORT_OVERALL = ['PASS', 'REVIEW', 'BLOCK'] as const;
export type QaReportOverallStatus = (typeof QA_REPORT_OVERALL)[number];

export type EvidenceRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type QaFindingEvidence = {
  referenceAssetVersionIds?: string[];
  candidateAssetVersionId: string;
  regions: EvidenceRegion[];
  ocrExpected?: string | null;
  ocrObserved?: string | null;
  metrics?: Record<string, unknown>;
};

export type QaFinding = {
  ruleId: string;
  ruleVersion: number;
  evaluator: string;
  status: QaFindingStatus;
  severity: RuleSeverity;
  nonWaivable: boolean;
  score?: number | null;
  message: string;
  evidence: QaFindingEvidence;
  suggestedAction?: string | null;
};

export function normalizeRegion(r: EvidenceRegion): EvidenceRegion {
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
  return {
    x: clamp01(r.x),
    y: clamp01(r.y),
    width: clamp01(r.width),
    height: clamp01(r.height),
  };
}

export function fullFrameRegion(): EvidenceRegion {
  return { x: 0, y: 0, width: 1, height: 1 };
}

/**
 * Spec §31.14 aggregation truth table (authoritative over §11.5 prose).
 * MAIN hard-rule FAIL is HIGH and therefore BLOCK.
 */
export function aggregateQaReport(findings: QaFinding[]): QaReportOverallStatus {
  if (findings.some((f) => f.status === 'FAIL' && f.nonWaivable)) return 'BLOCK';
  if (findings.some((f) => f.status === 'FAIL' && (f.severity === 'CRITICAL' || f.severity === 'HIGH'))) {
    return 'BLOCK';
  }
  if (findings.some((f) => f.status === 'FAIL')) return 'REVIEW';
  if (findings.some((f) => f.status === 'REVIEW')) return 'REVIEW';
  return 'PASS';
}

export function hasNonWaivableFail(findings: QaFinding[]): boolean {
  return findings.some((f) => f.nonWaivable && f.status === 'FAIL');
}

export function qaInputFingerprint(input: {
  assetVersionId: string;
  assetSha256: string;
  rulePackKey: string;
  rulePackVersion: number;
  rulePackSha256: string;
  truthRevisionId: string | null;
  shotBriefRevisionId: string | null;
  slot: string | null;
  ocrModelId: string;
  visionModelId: string;
}): string {
  return sha256Hex(canonicalizeJcs(input));
}
