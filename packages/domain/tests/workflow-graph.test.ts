import { describe, expect, it } from 'vitest';
import {
  emptyWorkflowGraph,
  validateEdge,
  validateWorkflowGraph,
  detectCycles,
  findCycle,
  arePortTypesCompatible,
  listPaletteNodeTypes,
  getNodeDefinition,
  type WorkflowGraph,
  type GraphEdge,
  type GraphNode,
} from '../src/workflow-graph.js';

function node(id: string, type: string, x = 0, y = 0): GraphNode {
  return { id, type, position: { x, y }, config: { schemaVersion: 1 } };
}

function edge(
  id: string,
  source: string,
  target: string,
  sourceHandle?: string,
  targetHandle?: string,
): GraphEdge {
  return { id, source, target, sourceHandle, targetHandle };
}

describe('node registry', () => {
  it('exposes palette nodes and hides approval_selector', () => {
    const palette = listPaletteNodeTypes();
    expect(palette.some((n) => n.type === 'generate')).toBe(true);
    expect(palette.some((n) => n.type === 'approval_selector')).toBe(false);
    expect(getNodeDefinition('approval_selector')?.palette).toBe(false);
  });

  it('IMAGE may feed IMAGE_LIST', () => {
    expect(arePortTypesCompatible('IMAGE', 'IMAGE_LIST')).toBe(true);
    expect(arePortTypesCompatible('PROMPT', 'IMAGE')).toBe(false);
  });
});

describe('edge validation (W3-04)', () => {
  it('blocks self-loop', () => {
    const graph: WorkflowGraph = {
      schemaVersion: 1,
      nodes: [node('n1', 'generate')],
      edges: [],
    };
    const result = validateEdge(graph, edge('e1', 'n1', 'n1', 'images', 'references'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === 'SELF_LOOP')).toBe(true);
  });

  it('blocks port type mismatch', () => {
    const graph: WorkflowGraph = {
      schemaVersion: 1,
      nodes: [node('n1', 'prompt'), node('n2', 'upscale')],
      edges: [],
    };
    const result = validateEdge(graph, edge('e1', 'n1', 'n2', 'prompt', 'image'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === 'PORT_TYPE_MISMATCH')).toBe(true);
  });

  it('blocks duplicate edges', () => {
    const graph: WorkflowGraph = {
      schemaVersion: 1,
      nodes: [node('n1', 'source_image'), node('n2', 'generate')],
      edges: [edge('e0', 'n1', 'n2', 'image', 'references')],
    };
    const result = validateEdge(graph, edge('e1', 'n1', 'n2', 'image', 'references'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === 'DUPLICATE_EDGE')).toBe(true);
  });

  it('blocks cross-layer back-edge / cycle (qa → generate)', () => {
    const graph: WorkflowGraph = {
      schemaVersion: 1,
      nodes: [node('g', 'generate'), node('q', 'qa_gate')],
      edges: [],
    };
    const result = validateEdge(graph, edge('e1', 'q', 'g', 'candidates', 'references'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain('CROSS_LAYER_BACK_EDGE');
    }
  });

  it('allows legal IMAGE → IMAGE_LIST edge', () => {
    const graph: WorkflowGraph = {
      schemaVersion: 1,
      nodes: [node('s', 'source_image'), node('g', 'generate'), node('p', 'prompt'), node('t', 'product_truth')],
      edges: [],
    };
    const result = validateEdge(graph, edge('e1', 's', 'g', 'image', 'references'));
    expect(result.ok).toBe(true);
  });
});

describe('cycle detection', () => {
  it('detects A→B→A cycle within transform layer', () => {
    const graph: WorkflowGraph = {
      schemaVersion: 1,
      nodes: [node('a', 'upscale'), node('b', 'upscale')],
      edges: [edge('e1', 'a', 'b', 'image', 'image'), edge('e2', 'b', 'a', 'image', 'image')],
    };
    expect(findCycle(graph)).not.toBeNull();
    expect(detectCycles(graph).some((i) => i.code === 'CYCLE')).toBe(true);
    const v = validateWorkflowGraph(graph);
    expect(v.ok).toBe(false);
  });

  it('empty graph is valid', () => {
    expect(validateWorkflowGraph(emptyWorkflowGraph()).ok).toBe(true);
  });

  it('rejects cyclic graphs on full validate (cannot save)', () => {
    const graph: WorkflowGraph = {
      schemaVersion: 1,
      nodes: [node('a', 'generate'), node('b', 'qa_gate'), node('c', 'generate')],
      edges: [
        edge('e1', 'a', 'b', 'images', 'images'),
        // cross-layer + would cycle if b feeds c and c feeds a — use same-layer cycle
      ],
    };
    // Build a same-layer cycle with upscale chain
    const cyclic: WorkflowGraph = {
      schemaVersion: 1,
      nodes: [node('u1', 'upscale'), node('u2', 'upscale'), node('u3', 'upscale')],
      edges: [
        edge('e1', 'u1', 'u2', 'image', 'image'),
        edge('e2', 'u2', 'u3', 'image', 'image'),
        edge('e3', 'u3', 'u1', 'image', 'image'),
      ],
    };
    const v = validateWorkflowGraph(cyclic);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.issues.some((i) => i.code === 'CYCLE')).toBe(true);
    void graph;
  });
});
