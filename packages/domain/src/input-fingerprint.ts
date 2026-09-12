/**
 * Input fingerprint — spec §32.1 (RFC 8785 JCS → SHA-256).
 * Pure domain; hashing uses in-package SHA-256 (no node:crypto — Next client safe).
 */

import { canonicalizeJcs } from './jcs.js';
import { sha256Hex } from './sha256.js';
import { getNodeDefinition } from './workflow-graph.js';

/** Deterministic pipeline / adapter version pins for reproducibility claims. */
export const PROVIDER_ADAPTER_VERSION = 'fake-image-adapter@1';
export const DETERMINISTIC_IMAGE_PIPELINE_VERSION = 'studio-image-pipeline@1';

export type UpstreamAssetRef = {
  portId: string;
  order: number;
  assetVersionId: string;
  sha256: string;
};

export type MaskRef = {
  maskId: string;
  representationSha256: string;
};

export type InputFingerprintPayload = {
  nodeType: string;
  nodeDefinitionVersion: number;
  nodeConfig: Record<string, unknown>;
  upstreamAssets: UpstreamAssetRef[];
  masks: MaskRef[];
  truthRevisionId: string | null;
  shotBriefRevisionId: string | null;
  prompt: string | null;
  negativePrompt: string | null;
  modelRegistryConfigVersion: number;
  providerAdapterVersion: string;
  deterministicImagePipelineVersion: string;
};

export type BuildFingerprintInput = {
  nodeType: string;
  nodeConfig: Record<string, unknown>;
  upstreamAssets?: UpstreamAssetRef[];
  masks?: MaskRef[];
  truthRevisionId?: string | null;
  shotBriefRevisionId?: string | null;
  prompt?: string | null;
  negativePrompt?: string | null;
  modelRegistryConfigVersion: number;
  /** When any required field is unknown, reproducibility claims are forbidden. */
  unknownFields?: string[];
};

export type FingerprintResult = {
  payload: InputFingerprintPayload;
  canonicalJson: string;
  sha256: string;
  /** Spec: 任一字段未知时禁止声称结果可复现 */
  reproducible: boolean;
  unknownFields: string[];
};

function sortAssets(assets: UpstreamAssetRef[]): UpstreamAssetRef[] {
  return [...assets].sort((a, b) => {
    if (a.portId !== b.portId) return a.portId < b.portId ? -1 : 1;
    if (a.order !== b.order) return a.order - b.order;
    return a.assetVersionId < b.assetVersionId ? -1 : a.assetVersionId > b.assetVersionId ? 1 : 0;
  });
}

function sortMasks(masks: MaskRef[]): MaskRef[] {
  return [...masks].sort((a, b) => (a.maskId < b.maskId ? -1 : a.maskId > b.maskId ? 1 : 0));
}

/** Deep-sort object keys for stable config embedding (JCS will re-sort anyway). */
export function normalizeConfigForFingerprint(config: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
}

export function buildInputFingerprintPayload(input: BuildFingerprintInput): InputFingerprintPayload {
  const def = getNodeDefinition(input.nodeType);
  const nodeDefinitionVersion = def?.version ?? 0;
  return {
    nodeType: input.nodeType,
    nodeDefinitionVersion,
    nodeConfig: normalizeConfigForFingerprint(input.nodeConfig ?? {}),
    upstreamAssets: sortAssets(input.upstreamAssets ?? []),
    masks: sortMasks(input.masks ?? []),
    truthRevisionId: input.truthRevisionId ?? null,
    shotBriefRevisionId: input.shotBriefRevisionId ?? null,
    prompt: input.prompt ?? null,
    negativePrompt: input.negativePrompt ?? null,
    modelRegistryConfigVersion: input.modelRegistryConfigVersion,
    providerAdapterVersion: PROVIDER_ADAPTER_VERSION,
    deterministicImagePipelineVersion: DETERMINISTIC_IMAGE_PIPELINE_VERSION,
  };
}

export function computeInputFingerprint(input: BuildFingerprintInput): FingerprintResult {
  const unknownFields = [...(input.unknownFields ?? [])];
  if (!getNodeDefinition(input.nodeType)) {
    unknownFields.push('nodeDefinitionVersion');
  }
  const payload = buildInputFingerprintPayload(input);
  const canonicalJson = canonicalizeJcs(payload);
  const sha256 = sha256Hex(canonicalJson);
  return {
    payload,
    canonicalJson,
    sha256,
    reproducible: unknownFields.length === 0,
    unknownFields,
  };
}

/** Generative node types never auto-reuse — user must opt in via reuseSucceededInputs. */
export const GENERATIVE_NODE_TYPES = new Set([
  'generate',
  'replace_background',
  'inpaint',
  'outpaint',
]);

/** Deterministic ops may auto-reuse identical fingerprints. */
export const DETERMINISTIC_NODE_TYPES = new Set(['remove_background', 'upscale']);

export function isGenerativeNodeType(type: string): boolean {
  return GENERATIVE_NODE_TYPES.has(type);
}

export function isDeterministicNodeType(type: string): boolean {
  return DETERMINISTIC_NODE_TYPES.has(type);
}
