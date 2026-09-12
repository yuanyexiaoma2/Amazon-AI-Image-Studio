/**
 * Workflow graph domain (W3-04): node registry, typed ports, edge validation, cycle detection.
 * Pure functions only — no Next.js / Prisma / BullMQ.
 */

export type PortType =
  | 'IMAGE'
  | 'IMAGE_LIST'
  | 'MASK'
  | 'PROMPT'
  | 'PRODUCT_TRUTH'
  | 'SHOT_BRIEF'
  | 'QA_REPORT'
  | 'QA_CANDIDATE_LIST'
  | 'APPROVED_ASSET_LIST';

export type WorkflowNodeType =
  | 'source_image'
  | 'product_truth'
  | 'prompt'
  | 'remove_background'
  | 'generate'
  | 'replace_background'
  | 'inpaint'
  | 'outpaint'
  | 'upscale'
  | 'qa_gate'
  | 'approval_selector'
  | 'export';

/** Pipeline layer for cross-layer back-edge checks (source → transform → qa → approval → export). */
export type PipelineLayer = 0 | 1 | 2 | 3 | 4;

export type PortDefinition = {
  id: string;
  type: PortType;
  /** Max incoming edges; 1 = single-value port. Output ports ignore this. */
  maxIncoming?: number;
  required?: boolean;
};

export type NodeTypeDefinition = {
  type: WorkflowNodeType;
  version: number;
  label: string;
  layer: PipelineLayer;
  /** When false, node is system-only (not shown in palette for manual create). */
  palette: boolean;
  inputPorts: PortDefinition[];
  outputPorts: PortDefinition[];
};

export type GraphNode = {
  id: string;
  type: WorkflowNodeType | string;
  position: { x: number; y: number };
  config?: Record<string, unknown>;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

export type WorkflowGraph = {
  schemaVersion: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type GraphIssueCode =
  | 'UNKNOWN_NODE_TYPE'
  | 'UNKNOWN_SOURCE_HANDLE'
  | 'UNKNOWN_TARGET_HANDLE'
  | 'PORT_TYPE_MISMATCH'
  | 'SELF_LOOP'
  | 'DUPLICATE_EDGE'
  | 'CROSS_LAYER_BACK_EDGE'
  | 'CYCLE'
  | 'MULTI_INCOMING'
  | 'MISSING_NODE'
  | 'EXPORT_REQUIRES_APPROVED';

export type GraphIssue = {
  code: GraphIssueCode;
  message: string;
  edgeId?: string;
  nodeId?: string;
};

export type EdgeValidationResult = { ok: true } | { ok: false; issues: GraphIssue[] };
export type GraphValidationResult = { ok: true } | { ok: false; issues: GraphIssue[] };

export const WORKFLOW_WRITE_ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const;

const WRITE_ROLES: ReadonlySet<string> = new Set(WORKFLOW_WRITE_ROLES);

export function canRoleWriteWorkflow(role: string): boolean {
  return WRITE_ROLES.has(role);
}

/** Spec §8.3 MVP node registry (rich Zod config schemas deferred to W3-05). */
export const NODE_REGISTRY: ReadonlyArray<NodeTypeDefinition> = [
  {
    type: 'source_image',
    version: 1,
    label: 'Source Image',
    layer: 0,
    palette: true,
    inputPorts: [],
    outputPorts: [{ id: 'image', type: 'IMAGE' }],
  },
  {
    type: 'product_truth',
    version: 1,
    label: 'Product Truth',
    layer: 0,
    palette: true,
    inputPorts: [],
    outputPorts: [{ id: 'truth', type: 'PRODUCT_TRUTH' }],
  },
  {
    type: 'prompt',
    version: 1,
    label: 'Prompt',
    layer: 0,
    palette: true,
    inputPorts: [{ id: 'shotBrief', type: 'SHOT_BRIEF', maxIncoming: 1, required: false }],
    outputPorts: [{ id: 'prompt', type: 'PROMPT' }],
  },
  {
    type: 'remove_background',
    version: 1,
    label: 'Remove Background',
    layer: 1,
    palette: true,
    inputPorts: [{ id: 'image', type: 'IMAGE', maxIncoming: 1, required: true }],
    outputPorts: [
      { id: 'image', type: 'IMAGE' },
      { id: 'mask', type: 'MASK' },
    ],
  },
  {
    type: 'generate',
    version: 1,
    label: 'Generate',
    layer: 1,
    palette: true,
    inputPorts: [
      { id: 'references', type: 'IMAGE_LIST', maxIncoming: 8, required: false },
      { id: 'prompt', type: 'PROMPT', maxIncoming: 1, required: true },
      { id: 'truth', type: 'PRODUCT_TRUTH', maxIncoming: 1, required: true },
    ],
    outputPorts: [{ id: 'images', type: 'IMAGE_LIST' }],
  },
  {
    type: 'replace_background',
    version: 1,
    label: 'Replace Background',
    layer: 1,
    palette: true,
    inputPorts: [
      { id: 'image', type: 'IMAGE', maxIncoming: 1, required: true },
      { id: 'mask', type: 'MASK', maxIncoming: 1, required: true },
      { id: 'prompt', type: 'PROMPT', maxIncoming: 1, required: false },
      { id: 'truth', type: 'PRODUCT_TRUTH', maxIncoming: 1, required: false },
    ],
    outputPorts: [{ id: 'images', type: 'IMAGE_LIST' }],
  },
  {
    type: 'inpaint',
    version: 1,
    label: 'Inpaint',
    layer: 1,
    palette: true,
    inputPorts: [
      { id: 'image', type: 'IMAGE', maxIncoming: 1, required: true },
      { id: 'mask', type: 'MASK', maxIncoming: 1, required: true },
      { id: 'prompt', type: 'PROMPT', maxIncoming: 1, required: false },
      { id: 'references', type: 'IMAGE_LIST', maxIncoming: 8, required: false },
    ],
    outputPorts: [{ id: 'images', type: 'IMAGE_LIST' }],
  },
  {
    type: 'outpaint',
    version: 1,
    label: 'Outpaint',
    layer: 1,
    palette: true,
    inputPorts: [
      { id: 'image', type: 'IMAGE', maxIncoming: 1, required: true },
      { id: 'prompt', type: 'PROMPT', maxIncoming: 1, required: false },
    ],
    outputPorts: [{ id: 'images', type: 'IMAGE_LIST' }],
  },
  {
    type: 'upscale',
    version: 1,
    label: 'Upscale',
    layer: 1,
    palette: true,
    inputPorts: [{ id: 'image', type: 'IMAGE', maxIncoming: 1, required: true }],
    outputPorts: [{ id: 'image', type: 'IMAGE' }],
  },
  {
    type: 'qa_gate',
    version: 1,
    label: 'QA Gate',
    layer: 2,
    palette: true,
    inputPorts: [
      { id: 'images', type: 'IMAGE_LIST', maxIncoming: 8, required: true },
      { id: 'truth', type: 'PRODUCT_TRUTH', maxIncoming: 1, required: true },
      { id: 'shotBrief', type: 'SHOT_BRIEF', maxIncoming: 1, required: false },
    ],
    outputPorts: [
      { id: 'report', type: 'QA_REPORT' },
      { id: 'candidates', type: 'QA_CANDIDATE_LIST' },
    ],
  },
  {
    type: 'approval_selector',
    version: 1,
    label: 'Approval Selector',
    layer: 3,
    palette: false,
    inputPorts: [{ id: 'candidates', type: 'QA_CANDIDATE_LIST', maxIncoming: 1, required: true }],
    outputPorts: [{ id: 'approvedAssets', type: 'APPROVED_ASSET_LIST' }],
  },
  {
    type: 'export',
    version: 1,
    label: 'Export',
    layer: 4,
    palette: true,
    inputPorts: [{ id: 'assets', type: 'APPROVED_ASSET_LIST', maxIncoming: 1, required: true }],
    outputPorts: [],
  },
];

const REGISTRY_BY_TYPE: ReadonlyMap<string, NodeTypeDefinition> = new Map(
  NODE_REGISTRY.map((n) => [n.type, n]),
);

export function getNodeDefinition(type: string): NodeTypeDefinition | undefined {
  return REGISTRY_BY_TYPE.get(type);
}

export function listPaletteNodeTypes(): NodeTypeDefinition[] {
  return NODE_REGISTRY.filter((n) => n.palette);
}

export function emptyWorkflowGraph(): WorkflowGraph {
  return { schemaVersion: 1, nodes: [], edges: [] };
}

/** Spec §8.2: IMAGE may feed IMAGE_LIST; otherwise exact match. */
export function arePortTypesCompatible(source: PortType, target: PortType): boolean {
  if (source === target) return true;
  if (source === 'IMAGE' && target === 'IMAGE_LIST') return true;
  return false;
}

function resolveHandle(
  def: NodeTypeDefinition,
  side: 'input' | 'output',
  handle: string | null | undefined,
): PortDefinition | undefined {
  const ports = side === 'input' ? def.inputPorts : def.outputPorts;
  if (handle) return ports.find((p) => p.id === handle);
  return ports.length === 1 ? ports[0] : undefined;
}

function edgeKey(e: Pick<GraphEdge, 'source' | 'target' | 'sourceHandle' | 'targetHandle'>): string {
  return `${e.source}|${e.sourceHandle ?? ''}->${e.target}|${e.targetHandle ?? ''}`;
}

/**
 * Validate a candidate edge against the registry and existing graph edges.
 * Does not mutate; used by UI for immediate reject and by save for full checks.
 */
export function validateEdge(
  graph: WorkflowGraph,
  candidate: GraphEdge,
  options?: { ignoreEdgeId?: string },
): EdgeValidationResult {
  const issues: GraphIssue[] = [];

  if (candidate.source === candidate.target) {
    issues.push({
      code: 'SELF_LOOP',
      message: 'Self-loop edges are not allowed',
      edgeId: candidate.id,
    });
    return { ok: false, issues };
  }

  const sourceNode = graph.nodes.find((n) => n.id === candidate.source);
  const targetNode = graph.nodes.find((n) => n.id === candidate.target);
  if (!sourceNode || !targetNode) {
    issues.push({
      code: 'MISSING_NODE',
      message: 'Edge references a missing node',
      edgeId: candidate.id,
    });
    return { ok: false, issues };
  }

  const sourceDef = getNodeDefinition(sourceNode.type);
  const targetDef = getNodeDefinition(targetNode.type);
  if (!sourceDef) {
    issues.push({
      code: 'UNKNOWN_NODE_TYPE',
      message: `Unknown source node type: ${sourceNode.type}`,
      nodeId: sourceNode.id,
      edgeId: candidate.id,
    });
  }
  if (!targetDef) {
    issues.push({
      code: 'UNKNOWN_NODE_TYPE',
      message: `Unknown target node type: ${targetNode.type}`,
      nodeId: targetNode.id,
      edgeId: candidate.id,
    });
  }
  if (!sourceDef || !targetDef) return { ok: false, issues };

  if (sourceDef.layer > targetDef.layer) {
    issues.push({
      code: 'CROSS_LAYER_BACK_EDGE',
      message: `Cross-layer back-edge from layer ${sourceDef.layer} (${sourceDef.type}) to layer ${targetDef.layer} (${targetDef.type})`,
      edgeId: candidate.id,
    });
  }

  const outPort = resolveHandle(sourceDef, 'output', candidate.sourceHandle);
  const inPort = resolveHandle(targetDef, 'input', candidate.targetHandle);
  if (!outPort) {
    issues.push({
      code: 'UNKNOWN_SOURCE_HANDLE',
      message: `Unknown source handle on ${sourceDef.type}`,
      edgeId: candidate.id,
    });
  }
  if (!inPort) {
    issues.push({
      code: 'UNKNOWN_TARGET_HANDLE',
      message: `Unknown target handle on ${targetDef.type}`,
      edgeId: candidate.id,
    });
  }
  if (outPort && inPort && !arePortTypesCompatible(outPort.type, inPort.type)) {
    issues.push({
      code: 'PORT_TYPE_MISMATCH',
      message: `Port type mismatch: ${outPort.type} → ${inPort.type}`,
      edgeId: candidate.id,
    });
  }

  if (inPort?.type === 'QA_CANDIDATE_LIST' && sourceDef.type !== 'qa_gate') {
    issues.push({
      code: 'PORT_TYPE_MISMATCH',
      message: 'QA_CANDIDATE_LIST may only come from qa_gate',
      edgeId: candidate.id,
    });
  }
  if (inPort?.type === 'APPROVED_ASSET_LIST' && sourceDef.type !== 'approval_selector') {
    issues.push({
      code: 'PORT_TYPE_MISMATCH',
      message: 'APPROVED_ASSET_LIST may only come from approval_selector',
      edgeId: candidate.id,
    });
  }
  if (
    targetDef.type === 'export' &&
    inPort &&
    inPort.type !== 'APPROVED_ASSET_LIST' &&
    (outPort?.type === 'IMAGE_LIST' || outPort?.type === 'IMAGE')
  ) {
    issues.push({
      code: 'EXPORT_REQUIRES_APPROVED',
      message: 'export cannot receive IMAGE/IMAGE_LIST without QA/approval',
      edgeId: candidate.id,
    });
  }

  const others = graph.edges.filter((e) => e.id !== candidate.id && e.id !== options?.ignoreEdgeId);
  const key = edgeKey(candidate);
  if (others.some((e) => edgeKey(e) === key)) {
    issues.push({
      code: 'DUPLICATE_EDGE',
      message: 'Duplicate edge between the same ports',
      edgeId: candidate.id,
    });
  }

  if (inPort) {
    const max = inPort.maxIncoming ?? 1;
    const incoming = others.filter(
      (e) => e.target === candidate.target && (e.targetHandle ?? '') === (candidate.targetHandle ?? ''),
    ).length;
    if (incoming + 1 > max) {
      issues.push({
        code: 'MULTI_INCOMING',
        message: `Port ${inPort.id} accepts at most ${max} incoming edge(s)`,
        edgeId: candidate.id,
        nodeId: targetNode.id,
      });
    }
  }

  // Prospective cycle check
  const prospective: WorkflowGraph = {
    ...graph,
    edges: [...others, candidate],
  };
  const cycle = findCycle(prospective);
  if (cycle) {
    issues.push({
      code: 'CYCLE',
      message: `Edge would create a cycle: ${cycle.join(' → ')}`,
      edgeId: candidate.id,
    });
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

/** DFS cycle detection; returns one cycle path (node ids) or null. */
export function findCycle(graph: WorkflowGraph): string[] | null {
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) adj.set(n.id, []);
  for (const e of graph.edges) {
    if (!adj.has(e.source) || !adj.has(e.target)) continue;
    adj.get(e.source)!.push(e.target);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function dfs(id: string): string[] | null {
    visiting.add(id);
    stack.push(id);
    for (const next of adj.get(id) ?? []) {
      if (visited.has(next)) continue;
      if (visiting.has(next)) {
        const idx = stack.indexOf(next);
        return [...stack.slice(idx), next];
      }
      const found = dfs(next);
      if (found) return found;
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
    return null;
  }

  for (const id of adj.keys()) {
    if (!visited.has(id)) {
      const found = dfs(id);
      if (found) return found;
    }
  }
  return null;
}

export function detectCycles(graph: WorkflowGraph): GraphIssue[] {
  const cycle = findCycle(graph);
  if (!cycle) return [];
  return [
    {
      code: 'CYCLE',
      message: `Graph contains a cycle: ${cycle.join(' → ')}`,
    },
  ];
}

/** Full graph validation for save / snapshot (illegal graphs must not persist). */
export function validateWorkflowGraph(graph: WorkflowGraph): GraphValidationResult {
  const issues: GraphIssue[] = [];

  for (const node of graph.nodes) {
    if (!getNodeDefinition(node.type)) {
      issues.push({
        code: 'UNKNOWN_NODE_TYPE',
        message: `Unknown node type: ${node.type}`,
        nodeId: node.id,
      });
    }
  }

  const seenKeys = new Set<string>();
  for (const edge of graph.edges) {
    const result = validateEdge(
      { ...graph, edges: graph.edges.filter((e) => e.id !== edge.id) },
      edge,
    );
    if (!result.ok) {
      // Avoid duplicating CYCLE for every edge — collect unique codes carefully
      for (const issue of result.issues) {
        if (issue.code === 'CYCLE') continue;
        issues.push(issue);
      }
    }
    const key = edgeKey(edge);
    if (seenKeys.has(key)) {
      issues.push({
        code: 'DUPLICATE_EDGE',
        message: 'Duplicate edge between the same ports',
        edgeId: edge.id,
      });
    }
    seenKeys.add(key);
  }

  issues.push(...detectCycles(graph));

  // Deduplicate by code+edgeId+message
  const uniq = new Map<string, GraphIssue>();
  for (const i of issues) {
    uniq.set(`${i.code}|${i.edgeId ?? ''}|${i.nodeId ?? ''}|${i.message}`, i);
  }
  const list = [...uniq.values()];
  return list.length === 0 ? { ok: true } : { ok: false, issues: list };
}
