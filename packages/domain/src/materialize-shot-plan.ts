/**
 * W3-08 — Materialize approved Shot Plan canvasPayload → WorkflowGraph.
 * Pure domain: no Prisma / Next / Zod. Consumes ShotPlanCanvasPayload shape unchanged.
 */
import type { ShotPlanCanvasPayload, ShotBriefCanvasPayload } from './shot-plan.js';
import type { GraphEdge, GraphNode, WorkflowGraph } from './workflow-graph.js';
import { validateWorkflowGraph } from './workflow-graph.js';
import { buildHardenedNegative, buildHardenedPromptText } from './prompt-templates.js';

export type MaterializeResult =
  | { ok: true; graph: WorkflowGraph; briefCount: number }
  | { ok: false; code: 'EMPTY_BRIEFS' | 'INVALID_GRAPH'; message: string; issues?: unknown };

/** Collect unique asset version ids referenced by briefs (JSONB; validated at app layer). */
export function collectReferencedAssetVersionIds(payload: ShotPlanCanvasPayload): string[] {
  const ids = new Set<string>();
  for (const b of payload.briefs) {
    for (const id of b.referencedAssetVersionIds ?? []) {
      if (typeof id === 'string' && id.length > 0) ids.add(id);
    }
  }
  return [...ids];
}

function buildPromptText(brief: ShotBriefCanvasPayload): string {
  return buildHardenedPromptText({
    slot: brief.slot,
    purpose: brief.purpose,
    must: brief.must,
    mustNot: brief.mustNot,
  });
}

/**
 * Build a 7-image (N-brief) workflow graph from canvasPayload.
 * Shared: source_image, product_truth, qa_gate, approval_selector, export.
 * Per brief: prompt + generate (wired into shared QA → approval → export).
 * Matches spec §7.5 topology, expanded across all ordered briefs.
 */
export function materializeShotPlanToGraph(payload: ShotPlanCanvasPayload): MaterializeResult {
  const briefs = [...payload.briefs].sort((a, b) => a.orderIndex - b.orderIndex);
  if (briefs.length === 0) {
    return { ok: false, code: 'EMPTY_BRIEFS', message: 'Shot Plan canvasPayload has no briefs' };
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const sourceId = 'n-source';
  const truthId = 'n-truth';
  const qaId = 'n-qa';
  const approvalId = 'n-approval';
  const exportId = 'n-export';

  const firstAsset =
    briefs.flatMap((b) => b.referencedAssetVersionIds ?? []).find((id) => !!id) ?? null;

  nodes.push({
    id: sourceId,
    type: 'source_image',
    position: { x: 0, y: 80 },
    config: {
      schemaVersion: 1,
      assetVersionId: firstAsset,
    },
  });

  nodes.push({
    id: truthId,
    type: 'product_truth',
    position: { x: 0, y: 280 },
    config: {
      schemaVersion: 1,
      truthRevisionId: payload.truthRevisionId,
    },
  });

  briefs.forEach((brief, i) => {
    const promptId = `n-prompt-${brief.orderIndex}`;
    const genId = `n-generate-${brief.orderIndex}`;
    const y = i * 140;

    nodes.push({
      id: promptId,
      type: 'prompt',
      position: { x: 280, y },
      config: {
        schemaVersion: 1,
        text: buildPromptText(brief),
        negative: buildHardenedNegative(brief.mustNot, brief.slot),
        locale: 'en-US',
        shotBriefId: brief.briefId,
        slot: brief.slot,
      },
    });

    nodes.push({
      id: genId,
      type: 'generate',
      position: { x: 560, y },
      config: {
        schemaVersion: 1,
        modelKey: 'primary-image-edit',
        ratio: brief.aspectRatio || '1:1',
        resolution: '2K',
        count: 2,
        seed: null,
        briefSlot: brief.slot,
        briefOrderIndex: brief.orderIndex,
      },
    });

    edges.push({
      id: `e-src-${brief.orderIndex}`,
      source: sourceId,
      target: genId,
      sourceHandle: 'image',
      targetHandle: 'references',
    });
    edges.push({
      id: `e-truth-gen-${brief.orderIndex}`,
      source: truthId,
      target: genId,
      sourceHandle: 'truth',
      targetHandle: 'truth',
    });
    edges.push({
      id: `e-prompt-${brief.orderIndex}`,
      source: promptId,
      target: genId,
      sourceHandle: 'prompt',
      targetHandle: 'prompt',
    });
    edges.push({
      id: `e-gen-qa-${brief.orderIndex}`,
      source: genId,
      target: qaId,
      sourceHandle: 'images',
      targetHandle: 'images',
    });
  });

  const mainBrief = briefs.find((b) => b.slot === 'MAIN') ?? briefs[0]!;

  nodes.push({
    id: qaId,
    type: 'qa_gate',
    position: { x: 840, y: 80 },
    config: {
      schemaVersion: 1,
      policyKey: mainBrief.qaPolicy || 'amazon-generic-us-v1',
    },
  });

  nodes.push({
    id: approvalId,
    type: 'approval_selector',
    position: { x: 1120, y: 80 },
    config: {
      schemaVersion: 1,
      requiredRole: 'REVIEWER',
    },
  });

  nodes.push({
    id: exportId,
    type: 'export',
    position: { x: 1400, y: 80 },
    config: {
      schemaVersion: 1,
      namingPreset: 'amazon-listing-v1',
      format: 'png',
      sourcePlanRevisionId: payload.planRevisionId,
    },
  });

  edges.push({
    id: 'e-truth-qa',
    source: truthId,
    target: qaId,
    sourceHandle: 'truth',
    targetHandle: 'truth',
  });
  edges.push({
    id: 'e-qa-approval',
    source: qaId,
    target: approvalId,
    sourceHandle: 'candidates',
    targetHandle: 'candidates',
  });
  edges.push({
    id: 'e-approval-export',
    source: approvalId,
    target: exportId,
    sourceHandle: 'approvedAssets',
    targetHandle: 'assets',
  });

  const graph: WorkflowGraph = { schemaVersion: 1, nodes, edges };
  const validation = validateWorkflowGraph(graph);
  if (!validation.ok) {
    return {
      ok: false,
      code: 'INVALID_GRAPH',
      message: 'Materialized graph failed domain validation',
      issues: validation.issues,
    };
  }

  return { ok: true, graph, briefCount: briefs.length };
}
