/**
 * STALE propagation — spec §32.2.
 * Conservative revision-granularity BFS over workflow revision graph.
 */

import {
  getNodeDefinition,
  type GraphEdge,
  type GraphNode,
  type WorkflowGraph,
} from './workflow-graph.js';

export type StaleCause =
  | 'TRUTH_REVISION'
  | 'SHOT_BRIEF_REVISION'
  | 'NODE_CONFIG'
  | 'EDGE_CHANGE'
  | 'UPSTREAM_ASSET'
  | 'MASK_CHANGE'
  | 'MODEL_CONFIG';

export type StalePropagationEvent = {
  cause: StaleCause;
  seedNodeIds: string[];
  staleNodeIds: string[];
  reason: string;
  previousRevisionHint?: string | null;
  nextRevisionHint?: string | null;
};

export type NodeReads = {
  readsTruth: boolean;
  readsShotBrief: boolean;
};

/** Whether a node (by type / ports) consumes Product Truth or Shot Brief. */
export function nodeReads(node: GraphNode): NodeReads {
  const def = getNodeDefinition(node.type);
  const ports = def?.inputPorts ?? [];
  const readsTruth =
    ports.some((p) => p.type === 'PRODUCT_TRUTH') ||
    node.type === 'product_truth' ||
    (typeof node.config?.truthRevisionId === 'string' && node.config.truthRevisionId.length > 0);
  const readsShotBrief =
    ports.some((p) => p.type === 'SHOT_BRIEF') ||
    (typeof node.config?.shotBriefId === 'string' && !!node.config.shotBriefId);
  return { readsTruth, readsShotBrief };
}

/** Build forward adjacency (source → targets) for BFS descendants. */
export function buildForwardAdjacency(graph: WorkflowGraph): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) adj.set(n.id, []);
  for (const e of graph.edges) {
    if (!adj.has(e.source) || !adj.has(e.target)) continue;
    adj.get(e.source)!.push(e.target);
  }
  return adj;
}

/** BFS descendants including seeds. Stable order: seeds first, then discovery order. */
export function collectDescendantsInclusive(
  graph: WorkflowGraph,
  seedNodeIds: ReadonlyArray<string>,
): string[] {
  const adj = buildForwardAdjacency(graph);
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const out: string[] = [];
  const seen = new Set<string>();
  const queue: string[] = [];

  for (const id of seedNodeIds) {
    if (!nodeIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    queue.push(id);
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    out.push(id);
    for (const next of adj.get(id) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return out;
}

export function nodesReadingTruth(graph: WorkflowGraph): string[] {
  return graph.nodes.filter((n) => nodeReads(n).readsTruth).map((n) => n.id);
}

export function nodesReadingShotBrief(
  graph: WorkflowGraph,
  shotBriefId?: string | null,
): string[] {
  return graph.nodes
    .filter((n) => {
      const r = nodeReads(n);
      if (!r.readsShotBrief) return false;
      if (!shotBriefId) return true;
      return n.config?.shotBriefId === shotBriefId;
    })
    .map((n) => n.id);
}

export function propagateStaleFromSeeds(
  graph: WorkflowGraph,
  seeds: ReadonlyArray<string>,
  cause: StaleCause,
  reason: string,
  revisionHints?: { previous?: string | null; next?: string | null },
): StalePropagationEvent {
  const staleNodeIds = collectDescendantsInclusive(graph, seeds);
  return {
    cause,
    seedNodeIds: [...seeds],
    staleNodeIds,
    reason,
    previousRevisionHint: revisionHints?.previous ?? null,
    nextRevisionHint: revisionHints?.next ?? null,
  };
}

/** Truth revision change → all truth-reading nodes + descendants. */
export function propagateStaleFromTruthChange(
  graph: WorkflowGraph,
  hints?: { previous?: string | null; next?: string | null },
): StalePropagationEvent {
  const seeds = nodesReadingTruth(graph);
  return propagateStaleFromSeeds(
    graph,
    seeds,
    'TRUTH_REVISION',
    'Product Truth revision changed',
    hints,
  );
}

/** Shot Brief revision change. */
export function propagateStaleFromShotBriefChange(
  graph: WorkflowGraph,
  shotBriefId?: string | null,
  hints?: { previous?: string | null; next?: string | null },
): StalePropagationEvent {
  const seeds = nodesReadingShotBrief(graph, shotBriefId);
  return propagateStaleFromSeeds(
    graph,
    seeds,
    'SHOT_BRIEF_REVISION',
    'Shot Brief revision changed',
    hints,
  );
}

/**
 * Diff two graphs; return nodes whose config, incident edges, or identity changed,
 * then propagate STALE to those nodes + descendants (§32.2.3).
 */
export function propagateStaleFromGraphDiff(
  previous: WorkflowGraph,
  next: WorkflowGraph,
): StalePropagationEvent {
  const prevById = new Map(previous.nodes.map((n) => [n.id, n]));
  const nextById = new Map(next.nodes.map((n) => [n.id, n]));
  const seeds = new Set<string>();

  for (const [id, nextNode] of nextById) {
    const prev = prevById.get(id);
    if (!prev) {
      seeds.add(id);
      continue;
    }
    if (prev.type !== nextNode.type) {
      seeds.add(id);
      continue;
    }
    if (canonicalizeConfig(prev.config) !== canonicalizeConfig(nextNode.config)) {
      seeds.add(id);
    }
  }
  for (const id of prevById.keys()) {
    if (!nextById.has(id)) {
      for (const e of previous.edges) {
        if (e.source === id) seeds.add(e.target);
      }
    }
  }

  const edgeKey = (e: GraphEdge) =>
    `${e.source}|${e.sourceHandle ?? ''}->${e.target}|${e.targetHandle ?? ''}`;
  const prevEdges = new Set(previous.edges.map(edgeKey));
  const nextEdges = new Set(next.edges.map(edgeKey));
  for (const e of next.edges) {
    if (!prevEdges.has(edgeKey(e))) {
      seeds.add(e.target);
      seeds.add(e.source);
    }
  }
  for (const e of previous.edges) {
    if (!nextEdges.has(edgeKey(e))) {
      seeds.add(e.target);
      seeds.add(e.source);
    }
  }

  return propagateStaleFromSeeds(
    next,
    [...seeds].filter((id) => nextById.has(id)),
    'EDGE_CHANGE',
    'Node config, edges, or upstream bindings changed',
  );
}

function canonicalizeConfig(config: Record<string, unknown> | undefined): string {
  return JSON.stringify(config ?? {});
}

/** Mark a single node + descendants after upstream asset / mask / model change. */
export function propagateStaleFromNodeInputs(
  graph: WorkflowGraph,
  nodeId: string,
  cause: Extract<StaleCause, 'UPSTREAM_ASSET' | 'MASK_CHANGE' | 'MODEL_CONFIG' | 'NODE_CONFIG'>,
  reason: string,
): StalePropagationEvent {
  return propagateStaleFromSeeds(graph, [nodeId], cause, reason);
}
