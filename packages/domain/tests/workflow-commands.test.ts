import { describe, expect, it } from 'vitest';
import {
  applyWorkflowCommands,
  WorkflowCommandError,
  type ApplyWorkflowCommandsOptions,
  type NodeConfigValidationResult,
  type WorkflowCommand,
} from '../src/workflow-commands.js';
import { emptyWorkflowGraph, type GraphEdge, type GraphNode, type WorkflowGraph } from '../src/workflow-graph.js';

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

/** Base graph: source image + prompt + truth feeding a generate node. */
function baseGraph(): WorkflowGraph {
  return {
    schemaVersion: 1,
    nodes: [
      node('s', 'source_image'),
      node('p', 'prompt'),
      node('t', 'product_truth'),
      node('g', 'generate'),
    ],
    edges: [
      edge('e-sp', 'p', 'g', 'prompt', 'prompt'),
      edge('e-st', 't', 'g', 'truth', 'truth'),
    ],
  };
}

function deterministicIds(): ApplyWorkflowCommandsOptions['generateId'] {
  let seq = 0;
  return (kind, seed) => (kind === 'node' ? `n-${seed}-test-${seq++}` : `e-${seed}-test-${seq++}`);
}

/** Mimics contracts validateNodeConfig: fills defaults, rejects bad generate.count. */
function strictValidate(nodeType: string, config: unknown): NodeConfigValidationResult {
  const c = (config ?? {}) as Record<string, unknown>;
  if (nodeType === 'generate') {
    if (c.count !== undefined && (typeof c.count !== 'number' || c.count < 1 || c.count > 8)) {
      return { ok: false, issues: ['count: Number must be less than or equal to 8'] };
    }
    return { ok: true, config: { schemaVersion: 1, modelKey: 'primary-image-edit', count: 2, ...c } };
  }
  return { ok: true, config: { schemaVersion: 1, ...c } };
}

function expectCommandError(fn: () => unknown, code: string, commandIndex: number): void {
  try {
    fn();
    expect.unreachable(`expected WorkflowCommandError ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(WorkflowCommandError);
    const e = err as WorkflowCommandError;
    expect(e.code).toBe(code);
    expect(e.commandIndex).toBe(commandIndex);
    expect(e.message).toContain(`command[${commandIndex}]`);
  }
}

describe('applyWorkflowCommands — addNode', () => {
  it('adds a node with default config when config omitted', () => {
    const result = applyWorkflowCommands(emptyWorkflowGraph(), [
      { type: 'addNode', nodeType: 'generate', nodeId: 'g1', position: { x: 10, y: 20 } },
    ]);
    expect(result.graph.nodes).toHaveLength(1);
    expect(result.graph.nodes[0]).toMatchObject({
      id: 'g1',
      type: 'generate',
      position: { x: 10, y: 20 },
      config: { schemaVersion: 1 },
    });
    expect(result.name).toBeUndefined();
  });

  it('generates a node id via injected generateId when nodeId omitted', () => {
    const result = applyWorkflowCommands(
      emptyWorkflowGraph(),
      [{ type: 'addNode', nodeType: 'prompt', position: { x: 0, y: 0 } }],
      { generateId: deterministicIds() },
    );
    expect(result.graph.nodes[0]!.id).toBe('n-prompt-test-0');
  });

  it('validates provided config via injected validator', () => {
    const result = applyWorkflowCommands(
      emptyWorkflowGraph(),
      [
        {
          type: 'addNode',
          nodeType: 'generate',
          nodeId: 'g1',
          position: { x: 0, y: 0 },
          config: { count: 4 },
        },
      ],
      { validateNodeConfig: strictValidate },
    );
    expect(result.graph.nodes[0]!.config).toMatchObject({ count: 4, modelKey: 'primary-image-edit' });
  });

  it('rejects system-only approval_selector', () => {
    expectCommandError(
      () =>
        applyWorkflowCommands(emptyWorkflowGraph(), [
          { type: 'addNode', nodeType: 'approval_selector', position: { x: 0, y: 0 } },
        ]),
      'NODE_TYPE_NOT_IN_PALETTE',
      0,
    );
  });

  it('rejects unknown nodeType', () => {
    expectCommandError(
      () =>
        applyWorkflowCommands(emptyWorkflowGraph(), [
          { type: 'addNode', nodeType: 'magic_wand', position: { x: 0, y: 0 } },
        ]),
      'UNKNOWN_NODE_TYPE',
      0,
    );
  });

  it('rejects duplicate nodeId', () => {
    expectCommandError(
      () =>
        applyWorkflowCommands(baseGraph(), [
          { type: 'addNode', nodeType: 'prompt', nodeId: 'p', position: { x: 0, y: 0 } },
        ]),
      'DUPLICATE_NODE_ID',
      0,
    );
  });
});

describe('applyWorkflowCommands — connect', () => {
  it('connects a legal edge (IMAGE → IMAGE_LIST)', () => {
    const result = applyWorkflowCommands(baseGraph(), [
      { type: 'connect', source: 's', sourceHandle: 'image', target: 'g', targetHandle: 'references' },
    ]);
    expect(result.graph.edges).toHaveLength(3);
    expect(result.graph.edges[2]).toMatchObject({ source: 's', target: 'g' });
  });

  it('generates an edge id when edgeId omitted', () => {
    const result = applyWorkflowCommands(
      baseGraph(),
      [{ type: 'connect', source: 's', sourceHandle: 'image', target: 'g', targetHandle: 'references' }],
      { generateId: deterministicIds() },
    );
    expect(result.graph.edges[2]!.id).toBe('e-s-g-test-0');
  });

  it('rejects self-loop', () => {
    expectCommandError(
      () =>
        applyWorkflowCommands(baseGraph(), [
          { type: 'connect', source: 'g', sourceHandle: 'images', target: 'g', targetHandle: 'references' },
        ]),
      'SELF_LOOP',
      0,
    );
  });

  it('rejects port type mismatch', () => {
    const graph: WorkflowGraph = {
      schemaVersion: 1,
      nodes: [node('p', 'prompt'), node('u', 'upscale')],
      edges: [],
    };
    expectCommandError(
      () =>
        applyWorkflowCommands(graph, [
          { type: 'connect', source: 'p', sourceHandle: 'prompt', target: 'u', targetHandle: 'image' },
        ]),
      'PORT_TYPE_MISMATCH',
      0,
    );
  });

  it('rejects cross-layer back-edge (qa_gate → generate)', () => {
    const graph: WorkflowGraph = {
      schemaVersion: 1,
      nodes: [node('g', 'generate'), node('q', 'qa_gate')],
      edges: [],
    };
    expectCommandError(
      () =>
        applyWorkflowCommands(graph, [
          { type: 'connect', source: 'q', sourceHandle: 'candidates', target: 'g', targetHandle: 'references' },
        ]),
      'CROSS_LAYER_BACK_EDGE',
      0,
    );
  });

  it('connect 已存在的相同边 → 幂等跳过（不抛错、图不变）', () => {
    const before = baseGraph();
    const result = applyWorkflowCommands(before, [
      { type: 'connect', source: 'p', sourceHandle: 'prompt', target: 'g', targetHandle: 'prompt' },
    ]);
    expect(result.graph.edges).toEqual(before.edges);
    expect(result.graph.nodes).toEqual(before.nodes);
  });

  it('同端点但端口不同的边仍会走校验（不允许双输入）', () => {
    expectCommandError(
      () =>
        applyWorkflowCommands(baseGraph(), [
          { type: 'connect', source: 'p', sourceHandle: 'prompt', target: 'g', targetHandle: 'references' },
        ]),
      'PORT_TYPE_MISMATCH',
      0,
    );
  });
});

describe('applyWorkflowCommands — disconnect', () => {
  it('removes an existing edge', () => {
    const result = applyWorkflowCommands(baseGraph(), [{ type: 'disconnect', edgeId: 'e-sp' }]);
    expect(result.graph.edges.map((e) => e.id)).toEqual(['e-st']);
  });

  it('throws EDGE_NOT_FOUND for unknown edgeId', () => {
    expectCommandError(
      () => applyWorkflowCommands(baseGraph(), [{ type: 'disconnect', edgeId: 'nope' }]),
      'EDGE_NOT_FOUND',
      0,
    );
  });
});

describe('applyWorkflowCommands — removeNode', () => {
  it('removes the node and all attached edges', () => {
    const result = applyWorkflowCommands(baseGraph(), [{ type: 'removeNode', nodeId: 'g' }]);
    expect(result.graph.nodes.map((n) => n.id)).toEqual(['s', 'p', 't']);
    expect(result.graph.edges).toHaveLength(0);
  });

  it('throws NODE_NOT_FOUND for unknown nodeId', () => {
    expectCommandError(
      () => applyWorkflowCommands(baseGraph(), [{ type: 'removeNode', nodeId: 'ghost' }]),
      'NODE_NOT_FOUND',
      0,
    );
  });
});

describe('applyWorkflowCommands — configure', () => {
  it('replaces config with the normalized config', () => {
    const result = applyWorkflowCommands(
      baseGraph(),
      [{ type: 'configure', nodeId: 'g', config: { count: 6 } }],
      { validateNodeConfig: strictValidate },
    );
    const g = result.graph.nodes.find((n) => n.id === 'g')!;
    expect(g.config).toEqual({ schemaVersion: 1, modelKey: 'primary-image-edit', count: 6 });
  });

  it('rejects invalid config', () => {
    expectCommandError(
      () =>
        applyWorkflowCommands(
          baseGraph(),
          [{ type: 'configure', nodeId: 'g', config: { count: 99 } }],
          { validateNodeConfig: strictValidate },
        ),
      'INVALID_NODE_CONFIG',
      0,
    );
  });

  it('throws NODE_NOT_FOUND for unknown nodeId', () => {
    expectCommandError(
      () => applyWorkflowCommands(baseGraph(), [{ type: 'configure', nodeId: 'ghost', config: {} }]),
      'NODE_NOT_FOUND',
      0,
    );
  });
});

describe('applyWorkflowCommands — moveNode / rename', () => {
  it('moves a node', () => {
    const result = applyWorkflowCommands(baseGraph(), [
      { type: 'moveNode', nodeId: 's', position: { x: 42, y: -7 } },
    ]);
    expect(result.graph.nodes.find((n) => n.id === 's')!.position).toEqual({ x: 42, y: -7 });
    expect(result.name).toBeUndefined();
  });

  it('rename returns the name without touching the graph', () => {
    const base = baseGraph();
    const result = applyWorkflowCommands(base, [
      { type: 'rename', name: 'Listing hero flow' },
    ]);
    expect(result.name).toBe('Listing hero flow');
    expect(result.graph.nodes).toEqual(base.nodes);
    expect(result.graph.edges).toEqual(base.edges);
  });
});

describe('applyWorkflowCommands — run placement', () => {
  const runCommand: WorkflowCommand = {
    type: 'run',
    scope: { type: 'ALL' },
    idempotencyKey: 'run-key-12345',
  };

  it('accepts a trailing run command and leaves the graph unchanged', () => {
    const base = baseGraph();
    const result = applyWorkflowCommands(base, [runCommand]);
    expect(result.graph).toEqual(base);
  });

  it('throws RUN_NOT_LAST when run is not the last command', () => {
    expectCommandError(
      () =>
        applyWorkflowCommands(baseGraph(), [
          runCommand,
          { type: 'rename', name: 'after run' },
        ]),
      'RUN_NOT_LAST',
      0,
    );
  });

  it('throws RUN_NOT_LAST when run appears twice', () => {
    expectCommandError(
      () => applyWorkflowCommands(baseGraph(), [runCommand, runCommand]),
      'RUN_NOT_LAST',
      0,
    );
  });

  it('allows run as the last command after other mutations', () => {
    const result = applyWorkflowCommands(baseGraph(), [
      { type: 'moveNode', nodeId: 's', position: { x: 1, y: 1 } },
      runCommand,
    ]);
    expect(result.graph.nodes.find((n) => n.id === 's')!.position).toEqual({ x: 1, y: 1 });
  });
});

describe('applyWorkflowCommands — atomicity', () => {
  it('does not mutate the input graph when a later command fails', () => {
    const base = baseGraph();
    const snapshot = JSON.parse(JSON.stringify(base)) as WorkflowGraph;
    expectCommandError(
      () =>
        applyWorkflowCommands(base, [
          { type: 'addNode', nodeType: 'generate', nodeId: 'u1', position: { x: 0, y: 0 } },
          { type: 'connect', source: 'u1', sourceHandle: 'images', target: 'u1', targetHandle: 'references' },
        ]),
      'SELF_LOOP',
      1,
    );
    expect(base).toEqual(snapshot);
  });

  it('applies multi-command batches in order', () => {
    const result = applyWorkflowCommands(baseGraph(), [
      { type: 'addNode', nodeType: 'generate', nodeId: 'u1', position: { x: 100, y: 0 } },
      { type: 'connect', source: 's', sourceHandle: 'image', target: 'u1', targetHandle: 'references' },
      { type: 'rename', name: 'batch flow' },
    ]);
    expect(result.graph.nodes).toHaveLength(5);
    expect(result.graph.edges).toHaveLength(3);
    expect(result.name).toBe('batch flow');
  });
});
