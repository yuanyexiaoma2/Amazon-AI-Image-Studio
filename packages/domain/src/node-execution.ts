/**
 * Node execution helpers (W5-A): map node types → ImageOperation, resolve graph inputs.
 */

import type { ImageOperation } from './model-registry.js';
import type { GraphEdge, GraphNode, WorkflowGraph } from './workflow-graph.js';
import { getNodeDefinition } from './workflow-graph.js';

export type ResolvedPortInput = {
  portId: string;
  sourceNodeId: string;
  sourceType: string;
  /** Config snapshot from source node (e.g. assetVersionId, text, truthRevisionId). */
  sourceConfig: Record<string, unknown>;
  order: number;
};

export function operationForNodeType(nodeType: string): ImageOperation | null {
  switch (nodeType) {
    case 'generate':
      return 'GENERATE';
    case 'remove_background':
      return 'REMOVE_BACKGROUND';
    case 'replace_background':
      return 'EDIT';
    case 'inpaint':
      return 'INPAINT';
    case 'outpaint':
      return 'OUTPAINT';
    case 'upscale':
      return 'UPSCALE';
    default:
      return null;
  }
}

/** Incoming edges to target, ordered by edge id for stability. */
export function incomingEdges(graph: WorkflowGraph, nodeId: string): GraphEdge[] {
  return graph.edges
    .filter((e) => e.target === nodeId)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function resolvePortInputs(graph: WorkflowGraph, nodeId: string): ResolvedPortInput[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const edges = incomingEdges(graph, nodeId);
  const out: ResolvedPortInput[] = [];
  const orderByPort = new Map<string, number>();
  for (const e of edges) {
    const src = byId.get(e.source);
    if (!src) continue;
    const def = getNodeDefinition(nodeId === e.target ? (byId.get(nodeId)?.type ?? '') : '');
    void def;
    const targetNode = byId.get(nodeId);
    const targetDef = targetNode ? getNodeDefinition(targetNode.type) : undefined;
    const portId =
      e.targetHandle ??
      targetDef?.inputPorts[0]?.id ??
      'input';
    const order = orderByPort.get(portId) ?? 0;
    orderByPort.set(portId, order + 1);
    out.push({
      portId,
      sourceNodeId: src.id,
      sourceType: src.type,
      sourceConfig: (src.config ?? {}) as Record<string, unknown>,
      order,
    });
  }
  return out;
}

export function extractPromptFromInputs(
  node: GraphNode,
  inputs: ResolvedPortInput[],
): { prompt: string; negativePrompt: string; shotBriefId: string | null } {
  const promptIn = inputs.find((i) => i.portId === 'prompt');
  const textFromPort =
    typeof promptIn?.sourceConfig.text === 'string' ? promptIn.sourceConfig.text : null;
  const negFromPort =
    typeof promptIn?.sourceConfig.negative === 'string' ? promptIn.sourceConfig.negative : '';
  const shotBriefId =
    typeof promptIn?.sourceConfig.shotBriefId === 'string'
      ? promptIn.sourceConfig.shotBriefId
      : typeof node.config?.shotBriefId === 'string'
        ? (node.config.shotBriefId as string)
        : null;
  const prompt =
    textFromPort ??
    (typeof node.config?.prompt === 'string' ? (node.config.prompt as string) : null) ??
    `Execute ${node.type} node ${node.id}`;
  return { prompt, negativePrompt: negFromPort, shotBriefId };
}

export function extractTruthRevisionId(
  node: GraphNode,
  inputs: ResolvedPortInput[],
): string | null {
  const truthIn = inputs.find((i) => i.portId === 'truth');
  if (typeof truthIn?.sourceConfig.truthRevisionId === 'string') {
    return truthIn.sourceConfig.truthRevisionId;
  }
  if (typeof node.config?.truthRevisionId === 'string') {
    return node.config.truthRevisionId as string;
  }
  return null;
}

export function extractReferenceAssetVersionIds(inputs: ResolvedPortInput[]): string[] {
  const ids: string[] = [];
  for (const i of inputs) {
    if (i.portId !== 'references' && i.portId !== 'image') continue;
    const av =
      typeof i.sourceConfig.assetVersionId === 'string' ? i.sourceConfig.assetVersionId : null;
    if (av) ids.push(av);
  }
  return ids;
}

export function resolutionToPixels(tier: string | undefined): { width: number; height: number } {
  switch (tier) {
    case '1K':
      return { width: 1024, height: 1024 };
    case '4K':
      return { width: 4096, height: 4096 };
    case '2K':
    default:
      return { width: 2048, height: 2048 };
  }
}

export function extractMaskId(
  node: GraphNode,
  inputs: ResolvedPortInput[],
): string | null {
  const maskIn = inputs.find((i) => i.portId === 'mask');
  if (typeof maskIn?.sourceConfig.maskId === 'string') {
    return maskIn.sourceConfig.maskId;
  }
  if (typeof node.config?.maskId === 'string') {
    return node.config.maskId as string;
  }
  return null;
}

export function extractImageAssetVersionId(inputs: ResolvedPortInput[]): string | null {
  const imageIn = inputs.find((i) => i.portId === 'image');
  if (typeof imageIn?.sourceConfig.assetVersionId === 'string') {
    return imageIn.sourceConfig.assetVersionId;
  }
  // fallback: first IMAGE-bearing upstream
  for (const i of inputs) {
    if (i.portId === 'image' || i.portId === 'references') {
      if (typeof i.sourceConfig.assetVersionId === 'string') return i.sourceConfig.assetVersionId;
    }
  }
  return null;
}

export type EditParams = {
  fidelity?: number;
  lightBlend?: number;
  strength?: number;
};

export function extractEditParams(node: GraphNode): EditParams {
  const cfg = (node.config ?? {}) as Record<string, unknown>;
  return {
    fidelity: typeof cfg.fidelity === 'number' ? cfg.fidelity : undefined,
    lightBlend: typeof cfg.lightBlend === 'number' ? cfg.lightBlend : undefined,
    strength: typeof cfg.strength === 'number' ? cfg.strength : undefined,
  };
}
