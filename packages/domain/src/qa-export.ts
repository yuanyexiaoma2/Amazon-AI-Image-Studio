/**
 * Export v1 filename / manifest / CSV (spec §32.11).
 */

import { canonicalizeJcs } from './jcs.js';
import { sha256Hex } from './sha256.js';
import type { ApprovalDecision } from './qa-approval.js';

export const EXPORT_CSV_COLUMNS = [
  'sku',
  'marketplace_code',
  'slot',
  'variant_code',
  'file_path',
  'asset_version_id',
  'qa_report_id',
  'qa_status',
  'approval_id',
  'approval_decision',
  'approval_actor_id',
  'approval_decided_at',
  'override_reason',
  'rule_id',
  'finding_status',
  'severity',
  'non_waivable',
  'message',
] as const;

export const SLOT_ORDER = ['MAIN', 'FEATURE', 'DETAIL', 'DIMENSION', 'LIFESTYLE', 'PACKAGE'] as const;

export type ExportManifestApproval = {
  id: string;
  decision: ApprovalDecision;
  actorId: string;
  decidedAt: string;
  reason: string | null;
};

export type ExportManifestFile = {
  path: string;
  sha256: string;
  bytes: number;
  mime: string;
  slot: string;
  variantCode: string;
  assetVersionId: string;
  qaReportId: string;
  approval: ExportManifestApproval;
  workflowRevisionId: string | null;
  winningAttemptId: string | null;
};

export type ExportManifestV1 = {
  schemaVersion: 1;
  bundleId: string;
  createdAt: string;
  workspaceId: string;
  projectId: string;
  sku: string;
  marketplaceCode: string;
  truthRevisionId: string | null;
  rulePack: { key: string; version: number };
  files: ExportManifestFile[];
};

export type ExportCsvRow = {
  sku: string;
  marketplace_code: string;
  slot: string;
  variant_code: string;
  file_path: string;
  asset_version_id: string;
  qa_report_id: string;
  qa_status: string;
  approval_id: string;
  approval_decision: string;
  approval_actor_id: string;
  approval_decided_at: string;
  override_reason: string;
  rule_id: string;
  finding_status: string;
  severity: string;
  non_waivable: string;
  message: string;
};

export function sanitizeExportToken(raw: string | null | undefined): string {
  const src = (raw && raw.trim()) || 'NA';
  const nfkd = src.normalize('NFKD');
  let ascii = '';
  for (const ch of nfkd) {
    const code = ch.charCodeAt(0);
    if (code <= 0x7f) ascii += ch.toUpperCase();
  }
  let cleaned = ascii.replace(/[^A-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!cleaned) cleaned = 'NA';
  if (cleaned.length > 120) cleaned = cleaned.slice(0, 120);
  return cleaned;
}

export function buildExportImagePath(input: {
  sku: string;
  marketplaceCode: string;
  slot: string;
  variantCode: string;
  outputIndex: number;
  versionNumber: number;
  ext?: string;
  usedPaths?: Set<string>;
}): string {
  const sku = sanitizeExportToken(input.sku);
  const market = sanitizeExportToken(input.marketplaceCode);
  const slot = sanitizeExportToken(input.slot);
  const variant = sanitizeExportToken(input.variantCode);
  const idx = String(input.outputIndex).padStart(2, '0');
  const ver = `v${input.versionNumber}`;
  const ext = (input.ext ?? 'png').toLowerCase();
  let name = `${sku}_${market}_${slot}_${variant}_${idx}_${ver}.${ext}`;
  if (input.usedPaths?.has(`images/${name}`)) {
    const hash = sha256Hex(`${name}:${input.sku}:${input.slot}`).slice(0, 6);
    name = `${sku}_${market}_${slot}_${variant}_${idx}_${ver}_${hash}.${ext}`;
  }
  const path = `images/${name}`;
  input.usedPaths?.add(path);
  return path;
}

export function slotSortIndex(slot: string): number {
  const i = (SLOT_ORDER as readonly string[]).indexOf(slot);
  return i === -1 ? 99 : i;
}

export function sortExportFiles<T extends { slot: string; variantCode: string; outputIndex?: number }>(
  files: T[],
): T[] {
  return [...files].sort((a, b) => {
    const s = slotSortIndex(a.slot) - slotSortIndex(b.slot);
    if (s !== 0) return s;
    if (a.variantCode !== b.variantCode) return a.variantCode < b.variantCode ? -1 : 1;
    return (a.outputIndex ?? 0) - (b.outputIndex ?? 0);
  });
}

export function buildManifestJson(manifest: ExportManifestV1): string {
  return canonicalizeJcs(manifest);
}

export function manifestSha256(manifest: ExportManifestV1): string {
  return sha256Hex(buildManifestJson(manifest));
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function buildQaReportCsv(rows: ExportCsvRow[]): string {
  const header = EXPORT_CSV_COLUMNS.join(',');
  const lines = rows.map((row) =>
    EXPORT_CSV_COLUMNS.map((col) => csvEscape(String(row[col] ?? ''))).join(','),
  );
  return `\uFEFF${[header, ...lines].join('\n')}\n`;
}

export function csvRowsFromManifest(input: {
  manifest: ExportManifestV1;
  findingsByReportId: Record<
    string,
    Array<{ ruleId: string; status: string; severity: string; nonWaivable: boolean; message: string }>
  >;
  qaStatusByReportId: Record<string, string>;
}): ExportCsvRow[] {
  const rows: ExportCsvRow[] = [];
  for (const file of sortExportFiles(input.manifest.files.map((f, i) => ({ ...f, outputIndex: i })))) {
    const findings = input.findingsByReportId[file.qaReportId] ?? [];
    const qaStatus = input.qaStatusByReportId[file.qaReportId] ?? '';
    const override =
      file.approval.decision === 'OVERRIDE_BLOCK' ? (file.approval.reason ?? '') : '';
    if (findings.length === 0) {
      rows.push({
        sku: input.manifest.sku,
        marketplace_code: input.manifest.marketplaceCode,
        slot: file.slot,
        variant_code: file.variantCode,
        file_path: file.path,
        asset_version_id: file.assetVersionId,
        qa_report_id: file.qaReportId,
        qa_status: qaStatus,
        approval_id: file.approval.id,
        approval_decision: file.approval.decision,
        approval_actor_id: file.approval.actorId,
        approval_decided_at: file.approval.decidedAt,
        override_reason: override,
        rule_id: '',
        finding_status: '',
        severity: '',
        non_waivable: '',
        message: '',
      });
      continue;
    }
    for (const f of findings) {
      rows.push({
        sku: input.manifest.sku,
        marketplace_code: input.manifest.marketplaceCode,
        slot: file.slot,
        variant_code: file.variantCode,
        file_path: file.path,
        asset_version_id: file.assetVersionId,
        qa_report_id: file.qaReportId,
        qa_status: qaStatus,
        approval_id: file.approval.id,
        approval_decision: file.approval.decision,
        approval_actor_id: file.approval.actorId,
        approval_decided_at: file.approval.decidedAt,
        override_reason: override,
        rule_id: f.ruleId,
        finding_status: f.status,
        severity: f.severity,
        non_waivable: f.nonWaivable ? 'true' : 'false',
        message: f.message,
      });
    }
  }
  return rows;
}
